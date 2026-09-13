pub mod openai_tag_generator;

use std::sync::Arc;

use sea_orm::prelude::async_trait::async_trait;

use crate::err::CadenzaError;
use serde::{Deserialize, Serialize};

/// a tag produced by a [`TagGenerator`], with a color reflecting the mood the
/// tag conveys
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GeneratedTag {
    pub name: String,
    pub color: String,
}

const DEFAULT_REQUESTED_TAG_COUNT: usize = 10;
const MAX_REQUESTED_TAG_COUNT: usize = 20;

/// the most bytes of song descriptions a [`TagGenerator`] is given in one call
pub const MAX_COMBINED_SONG_DESC_LENGTH: usize = 200;

#[derive(Clone)]
pub struct TagGenerationService(Arc<Box<dyn TagGenerator>>);

impl TagGenerationService {
    pub fn new(generator: impl TagGenerator + 'static) -> Self {
        TagGenerationService(Arc::new(Box::new(generator)))
    }

    /// returns a list of generated tags for each song, in the same order as `song_descs`.
    ///
    /// songs are sent to the generator in as many calls as it takes to keep each
    /// call under [`MAX_COMBINED_SONG_DESC_LENGTH`].
    pub async fn generate_tags(
        &self,
        song_descs: &[String],
        requested_tag_count: Option<usize>,
    ) -> Result<Vec<Vec<GeneratedTag>>, CadenzaError> {
        // use the default count when none is given, and never go over the max
        let requested_tag_count = requested_tag_count
            .unwrap_or(DEFAULT_REQUESTED_TAG_COUNT)
            .min(MAX_REQUESTED_TAG_COUNT);

        // cut down any description that is over the limit by itself, so one long
        // title can't fail the whole batch
        let song_descs: Vec<String> = song_descs
            .iter()
            .map(|desc| {
                let end = desc.floor_char_boundary(MAX_COMBINED_SONG_DESC_LENGTH);
                desc[..end].to_owned()
            })
            .collect();

        // generate one chunk at a time, collecting the results in input order
        let mut generated = Vec::with_capacity(song_descs.len());
        for chunk in chunk_song_descs(&song_descs) {
            let mut chunk_tags = self
                .0
                .generate_tags(chunk, requested_tag_count)
                .await
                .map_err(CadenzaError::TagGenerationErr)?;

            // the model can return the wrong number of tag lists. pad or trim to the
            // chunk's length so later chunks don't shift onto the wrong songs
            chunk_tags.resize(chunk.len(), Vec::new());
            generated.extend(chunk_tags);
        }

        Ok(generated)
    }
}

/// splits `song_descs` into consecutive chunks whose combined length is at most
/// [`MAX_COMBINED_SONG_DESC_LENGTH`], as long as no single description is over it
fn chunk_song_descs(song_descs: &[String]) -> Vec<&[String]> {
    let mut chunks = Vec::new();
    let mut chunk_start = 0;
    let mut chunk_len = 0;

    for (i, desc) in song_descs.iter().enumerate() {
        // close the current chunk if this description would push it over the limit
        if i > chunk_start && chunk_len + desc.len() > MAX_COMBINED_SONG_DESC_LENGTH {
            chunks.push(&song_descs[chunk_start..i]);
            chunk_start = i;
            chunk_len = 0;
        }
        chunk_len += desc.len();
    }

    // whatever is left over is the last chunk
    if chunk_start < song_descs.len() {
        chunks.push(&song_descs[chunk_start..]);
    }

    chunks
}

/// Tag Generators convert strings describing a song into tags.
///
/// e.g. "Override by Yoshida Yasei" -> "vocaloid", "japanese", "teto"
#[async_trait]
pub trait TagGenerator: Send + Sync {
    /// returns a list of generated tags for each song, or an err msg
    async fn generate_tags(
        &self,
        song_descs: &[String],
        requested_tag_count: usize,
    ) -> Result<Vec<Vec<GeneratedTag>>, String>;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// tags each song with its own description. rejects a call over the limit like
    /// the openai generator does, and can drop the last song's tags to act like a
    /// model that returns too few lists
    struct EchoTagGenerator {
        drop_last: bool,
    }

    #[async_trait]
    impl TagGenerator for EchoTagGenerator {
        async fn generate_tags(
            &self,
            song_descs: &[String],
            _: usize,
        ) -> Result<Vec<Vec<GeneratedTag>>, String> {
            // same length check as the real generator
            if song_descs.iter().map(String::len).sum::<usize>() > MAX_COMBINED_SONG_DESC_LENGTH {
                return Err("song descriptions are too long!".into());
            }

            // one tag per song, named after its description
            let mut tags: Vec<Vec<GeneratedTag>> = song_descs
                .iter()
                .map(|desc| {
                    vec![GeneratedTag {
                        name: desc.clone(),
                        color: "#808080".into(),
                    }]
                })
                .collect();

            // pretend the model forgot the last song
            if self.drop_last {
                tags.pop();
            }

            Ok(tags)
        }
    }

    /// 25 byte descriptions, numbered so they can be told apart
    fn numbered_descs(count: usize) -> Vec<String> {
        (0..count).map(|i| format!("{i:02} {}", "a".repeat(22))).collect()
    }

    #[tokio::test]
    async fn generate_tags_splits_batches_over_the_limit() {
        // 30 descriptions of 25 bytes each need several calls
        let service = TagGenerationService::new(EchoTagGenerator { drop_last: false });
        let descs = numbered_descs(30);

        let res = service.generate_tags(&descs, None).await.unwrap();

        // every song gets its own tags back, in order
        let names: Vec<&String> = res.iter().map(|tags| &tags[0].name).collect();
        assert_eq!(names, descs.iter().collect::<Vec<_>>());
    }

    #[tokio::test]
    async fn generate_tags_keeps_songs_aligned_when_a_chunk_comes_back_short() {
        // 16 descriptions of 25 bytes each make two chunks of 8
        let service = TagGenerationService::new(EchoTagGenerator { drop_last: true });
        let descs = numbered_descs(16);

        let res = service.generate_tags(&descs, None).await.unwrap();

        // the last song of each chunk gets no tags, and the second chunk still lines up
        assert_eq!(res.len(), 16);
        assert!(res[7].is_empty());
        assert_eq!(res[8][0].name, descs[8]);
        assert!(res[15].is_empty());
    }

    #[tokio::test]
    async fn generate_tags_truncates_a_description_over_the_limit() {
        // one byte, then 2 byte chars, so the limit falls in the middle of a char
        let service = TagGenerationService::new(EchoTagGenerator { drop_last: false });
        let descs = vec![format!("a{}", "\u{e9}".repeat(MAX_COMBINED_SONG_DESC_LENGTH))];

        let res = service.generate_tags(&descs, None).await.unwrap();

        // the cut backs off to the last whole char under the limit
        let expected = format!("a{}", "\u{e9}".repeat((MAX_COMBINED_SONG_DESC_LENGTH - 1) / 2));
        assert_eq!(res[0][0].name, expected);
    }
}

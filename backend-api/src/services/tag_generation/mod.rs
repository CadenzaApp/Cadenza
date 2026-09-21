pub mod openai_tag_generator;

use std::fmt;
use std::sync::Arc;

use sea_orm::prelude::async_trait::async_trait;

use crate::err::CadenzaError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TagSpecs {
    pub name: String,
    pub color: String,
}

const DEFAULT_REQUESTED_TAG_COUNT: usize = 7;
const MAX_REQUESTED_TAG_COUNT: usize = 20;

/// the most bytes of song descriptions a [`TagGenerator`] is given in one call
pub const MAX_COMBINED_SONG_DESC_LENGTH: usize = 2000;

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
    ) -> Result<Vec<Vec<TagSpecs>>, CadenzaError> {
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

        // logged once every chunk has succeeded, so a failed batch never logs a partial
        // result. the descriptions are the ones the generator was given, after truncation
        println!(
            "{}",
            GeneratedTagsLog {
                song_descs: &song_descs,
                generated: &generated,
            }
        );

        Ok(generated)
    }
}

/// A finished batch, ready to log.
struct GeneratedTagsLog<'a> {
    song_descs: &'a [String],
    generated: &'a [Vec<TagSpecs>],
}

/// Formats the batch as the block [`TagGenerationService::generate_tags`] logs, one line per
/// song, e.g.
///
/// ```text
/// tag generation: 2 songs
///   "Jolene by Dolly Parton" -> folk, country, storytelling
///   "Master of Puppets by Metallica" -> no tags
/// ```
impl fmt::Display for GeneratedTagsLog<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let song_count = self.song_descs.len();
        let plural = match song_count {
            1 => "",
            _ => "s",
        };
        write!(f, "tag generation: {song_count} song{plural}")?;

        // quoted, so a description carrying a comma stays readable as one song
        for (desc, tags) in self.song_descs.iter().zip(self.generated) {
            match tags.is_empty() {
                true => write!(f, "\n  {desc:?} -> no tags")?,
                false => {
                    let names: Vec<&str> = tags.iter().map(|tag| tag.name.as_str()).collect();
                    write!(f, "\n  {desc:?} -> {}", names.join(", "))?;
                }
            }
        }

        Ok(())
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
    ) -> Result<Vec<Vec<TagSpecs>>, String>;
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
        ) -> Result<Vec<Vec<TagSpecs>>, String> {
            // same length check as the real generator
            if song_descs.iter().map(String::len).sum::<usize>() > MAX_COMBINED_SONG_DESC_LENGTH {
                return Err("song descriptions are too long!".into());
            }

            // one tag per song, named after its description
            let mut tags: Vec<Vec<TagSpecs>> = song_descs
                .iter()
                .map(|desc| {
                    vec![TagSpecs {
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

    /// byte length of every description from [`numbered_descs`]
    const NUMBERED_DESC_LENGTH: usize = 25;

    /// how many numbered descriptions fit in one call
    const DESCS_PER_CHUNK: usize = MAX_COMBINED_SONG_DESC_LENGTH / NUMBERED_DESC_LENGTH;

    /// 25 byte descriptions, numbered so they can be told apart: a 4 digit number
    /// and a space, then padding
    fn numbered_descs(count: usize) -> Vec<String> {
        (0..count)
            .map(|i| format!("{i:04} {}", "a".repeat(NUMBERED_DESC_LENGTH - 5)))
            .collect()
    }

    #[tokio::test]
    async fn generate_tags_splits_batches_over_the_limit() {
        // three full chunks and part of a fourth, so several calls are needed
        let service = TagGenerationService::new(EchoTagGenerator { drop_last: false });
        let descs = numbered_descs(DESCS_PER_CHUNK * 3 + 1);

        let res = service.generate_tags(&descs, None).await.unwrap();

        // every song gets its own tags back, in order
        let names: Vec<&String> = res.iter().map(|tags| &tags[0].name).collect();
        assert_eq!(names, descs.iter().collect::<Vec<_>>());
    }

    #[tokio::test]
    async fn generate_tags_keeps_songs_aligned_when_a_chunk_comes_back_short() {
        // exactly two full chunks
        let service = TagGenerationService::new(EchoTagGenerator { drop_last: true });
        let descs = numbered_descs(DESCS_PER_CHUNK * 2);

        let res = service.generate_tags(&descs, None).await.unwrap();

        // the last song of each chunk gets no tags, and the second chunk still lines up
        assert_eq!(res.len(), DESCS_PER_CHUNK * 2);
        assert!(res[DESCS_PER_CHUNK - 1].is_empty());
        assert_eq!(res[DESCS_PER_CHUNK][0].name, descs[DESCS_PER_CHUNK]);
        assert!(res[DESCS_PER_CHUNK * 2 - 1].is_empty());
    }

    #[tokio::test]
    async fn generate_tags_truncates_descriptions_over_the_limit() {
        // one byte, then 2 byte chars, so the limit falls in the middle of a char
        let service = TagGenerationService::new(EchoTagGenerator { drop_last: false });
        let descs = vec![format!(
            "a{}",
            "\u{e9}".repeat(MAX_COMBINED_SONG_DESC_LENGTH)
        )];

        let res = service.generate_tags(&descs, None).await.unwrap();

        // the cut backs off to the last whole char under the limit
        let expected = format!(
            "a{}",
            "\u{e9}".repeat((MAX_COMBINED_SONG_DESC_LENGTH - 1) / 2)
        );
        assert_eq!(res[0][0].name, expected);
    }

    /// a tag with a color that never reaches the log
    fn tag(name: &str) -> TagSpecs {
        TagSpecs {
            name: name.into(),
            color: "#808080".into(),
        }
    }

    #[test]
    fn generated_tags_log_pairs_each_desc_with_its_own_tags() {
        let song_descs = vec![
            "Jolene by Dolly Parton".to_owned(),
            "Master of Puppets by Metallica".to_owned(),
        ];
        let generated = vec![vec![tag("folk"), tag("country")], Vec::new()];

        let log = GeneratedTagsLog {
            song_descs: &song_descs,
            generated: &generated,
        };

        // a song the model returned nothing for says so, rather than going missing
        assert_eq!(
            log.to_string(),
            concat!(
                "tag generation: 2 songs\n",
                "  \"Jolene by Dolly Parton\" -> folk, country\n",
                "  \"Master of Puppets by Metallica\" -> no tags",
            )
        );
    }

    #[test]
    fn generated_tags_log_quotes_a_desc_holding_a_comma() {
        let song_descs = vec!["September by Earth, Wind & Fire".to_owned()];
        let generated = vec![vec![tag("funk")]];

        let log = GeneratedTagsLog {
            song_descs: &song_descs,
            generated: &generated,
        };

        assert_eq!(
            log.to_string(),
            "tag generation: 1 song\n  \"September by Earth, Wind & Fire\" -> funk"
        );
    }
}

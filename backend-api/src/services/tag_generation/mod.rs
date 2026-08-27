pub mod openai_tag_generator;

use std::sync::Arc;

use sea_orm::prelude::async_trait::async_trait;

use crate::err::CadenzaError;

const DEFAULT_REQUESTED_TAG_COUNT: usize = 10;
const MAX_REQUESTED_TAG_COUNT: usize = 20;

#[derive(Clone)]
pub struct TagGenerationService(Arc<Box<dyn TagGenerator>>);

impl TagGenerationService {
    pub fn new(generator: impl TagGenerator + 'static) -> Self {
        TagGenerationService(Arc::new(Box::new(generator)))
    }

    pub async fn generate_tags(
        &self,
        song_descs: &[String],
        requested_tag_count: Option<usize>,
    ) -> Result<Vec<Vec<String>>, CadenzaError> {
        self.0
            .generate_tags(
                song_descs,
                requested_tag_count
                    .unwrap_or(DEFAULT_REQUESTED_TAG_COUNT)
                    .min(MAX_REQUESTED_TAG_COUNT),
            )
            .await
            .map_err(CadenzaError::TagGenerationErr)
    }
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
    ) -> Result<Vec<Vec<String>>, String>;
}

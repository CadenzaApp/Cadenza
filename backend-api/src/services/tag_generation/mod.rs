pub mod openai_tag_generator;

use sea_orm::prelude::async_trait::async_trait;

use crate::err::CadenzaError;

#[derive(Clone)]
pub struct TagGenerationService<G: TagGenerator>(G);

impl<G: TagGenerator> TagGenerationService<G> {
    pub fn new() -> Self {
        Self(G::new())
    }

    async fn generate_tags(
        &self,
        song_descs: &Vec<String>,
        requested_tag_count: usize,
    ) -> Result<Vec<Vec<String>>, CadenzaError> {
        self.0
            .generate_tags(song_descs, requested_tag_count)
            .await
            .map_err(|msg| CadenzaError::TagGenerationErr(msg))
    }
}

/// Tag Generators are things that convert strings describing a song into tags.
///
/// e.g. "Override by Yoshida Yasei" -> "vocaloid", "japanese", "teto"
#[async_trait]
pub trait TagGenerator : Clone {
    fn new() -> Self;

    /// returns a list of generated tags for each song, or an err msg
    async fn generate_tags(
        &self,
        song_descs: &Vec<String>,
        requested_tag_count: usize,
    ) -> Result<Vec<Vec<String>>, String>;
}

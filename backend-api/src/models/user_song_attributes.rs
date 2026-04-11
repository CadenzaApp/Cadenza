use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserSongAttributes {
    #[serde(default)]
    pub play_count: u32,

    #[serde(default)]
    pub is_favorite: bool,

    #[serde(default)]
    pub is_hidden: bool,
}

impl Default for UserSongAttributes {
    fn default() -> Self {
        Self {
            play_count: 0,
            is_favorite: false,
            is_hidden: false,
        }
    }
}

impl UserSongAttributes {
    pub fn builder() -> UserSongAttributesBuilder {
        UserSongAttributesBuilder::default()
    }

    pub fn increment_play_count(&mut self) {
        self.play_count = self.play_count.saturating_add(1);
    }

    pub fn favorite(&mut self) {
        self.is_favorite = true;
    }

    pub fn unfavorite(&mut self) {
        self.is_favorite = false;
    }

    pub fn hide(&mut self) {
        self.is_hidden = true;
    }

    pub fn unhide(&mut self) {
        self.is_hidden = false;
    }
}

#[derive(Debug, Clone, Default)]
pub struct UserSongAttributesBuilder {
    play_count: Option<u32>,
    is_favorite: Option<bool>,
    is_hidden: Option<bool>,
}

impl UserSongAttributesBuilder {
    pub fn play_count(mut self, play_count: u32) -> Self {
        self.play_count = Some(play_count);
        self
    }

    pub fn favorite(mut self, is_favorite: bool) -> Self {
        self.is_favorite = Some(is_favorite);
        self
    }

    pub fn hidden(mut self, is_hidden: bool) -> Self {
        self.is_hidden = Some(is_hidden);
        self
    }

    pub fn build(self) -> UserSongAttributes {
        UserSongAttributes {
            play_count: self.play_count.unwrap_or(0),
            is_favorite: self.is_favorite.unwrap_or(false),
            is_hidden: self.is_hidden.unwrap_or(false),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builder_sets_values() {
        let attrs = UserSongAttributes::builder()
            .play_count(12)
            .favorite(true)
            .hidden(true)
            .build();

        assert_eq!(attrs.play_count, 12);
        assert!(attrs.is_favorite);
        assert!(attrs.is_hidden);
    }

    #[test]
    fn increment_play_count_saturates() {
        let mut attrs = UserSongAttributes::builder().play_count(u32::MAX).build();
        attrs.increment_play_count();
        assert_eq!(attrs.play_count, u32::MAX);
    }
}

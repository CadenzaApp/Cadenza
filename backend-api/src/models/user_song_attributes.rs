use bon::Builder;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Builder)]
pub struct UserSongAttributes {
    #[builder(default)]
    #[serde(default)]
    pub play_count: u32,

    #[builder(default)]
    #[serde(default)]
    pub is_favorite: bool,

    #[builder(default)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builder_sets_values() {
        let attrs = UserSongAttributes::builder()
            .play_count(12)
            .is_favorite(true)
            .is_hidden(true)
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

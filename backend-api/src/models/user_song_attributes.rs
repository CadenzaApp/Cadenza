use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fmt::{Display, Formatter};

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserSongAttributesValidationError {
    PlayCountTooLarge,
}

impl Display for UserSongAttributesValidationError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            UserSongAttributesValidationError::PlayCountTooLarge => {
                write!(f, "play count is unrealistically large")
            }
        }
    }
}

impl Error for UserSongAttributesValidationError {}

impl UserSongAttributes {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_play_count(mut self, play_count: u32) -> Self {
        self.play_count = play_count;
        self
    }

    pub fn with_favorite(mut self, is_favorite: bool) -> Self {
        self.is_favorite = is_favorite;
        self
    }

    pub fn with_hidden(mut self, is_hidden: bool) -> Self {
        self.is_hidden = is_hidden;
        self
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

    pub fn validate(&self) -> Result<(), UserSongAttributesValidationError> {
        if self.play_count > 1_000_000_000 {
            return Err(UserSongAttributesValidationError::PlayCountTooLarge);
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_values_are_sensible() {
        let attrs = UserSongAttributes::default();

        assert_eq!(attrs.play_count, 0);
        assert!(!attrs.is_favorite);
        assert!(!attrs.is_hidden);
    }

    #[test]
    fn builder_methods_set_fields() {
        let attrs = UserSongAttributes::new()
            .with_play_count(12)
            .with_favorite(true)
            .with_hidden(true);

        assert_eq!(attrs.play_count, 12);
        assert!(attrs.is_favorite);
        assert!(attrs.is_hidden);
    }

    #[test]
    fn increment_play_count_increases_count() {
        let mut attrs = UserSongAttributes::new().with_play_count(5);

        attrs.increment_play_count();

        assert_eq!(attrs.play_count, 6);
    }

    #[test]
    fn increment_play_count_saturates_at_max() {
        let mut attrs = UserSongAttributes::new().with_play_count(u32::MAX);

        attrs.increment_play_count();

        assert_eq!(attrs.play_count, u32::MAX);
    }

    #[test]
    fn favorite_and_unfavorite_work() {
        let mut attrs = UserSongAttributes::new();

        attrs.favorite();
        assert!(attrs.is_favorite);

        attrs.unfavorite();
        assert!(!attrs.is_favorite);
    }

    #[test]
    fn hide_and_unhide_work() {
        let mut attrs = UserSongAttributes::new();

        attrs.hide();
        assert!(attrs.is_hidden);

        attrs.unhide();
        assert!(!attrs.is_hidden);
    }

    #[test]
    fn validate_accepts_normal_values() {
        let attrs = UserSongAttributes::new().with_play_count(250);
        assert_eq!(attrs.validate(), Ok(()));
    }

    #[test]
    fn validate_rejects_unreasonably_large_play_count() {
        let attrs = UserSongAttributes::new().with_play_count(1_000_000_001);

        assert_eq!(
            attrs.validate(),
            Err(UserSongAttributesValidationError::PlayCountTooLarge)
        );
    }
}

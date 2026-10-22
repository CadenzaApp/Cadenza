//! Private per user settings: appearance and content preferences. A user with
//! no row reads the defaults, and the row is created on their first change.

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, DatabaseConnection, EntityTrait, Iterable, prelude::Uuid,
    sea_query::OnConflict,
};
use serde::{Deserialize, Serialize};

use crate::db::entity::user_settings::{self, Column};
use crate::err::CadenzaError;

/// Light, dark, follow the system, or a custom background. Stored as its
/// lowercase name.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    System,
    Light,
    Dark,
    Custom,
}

impl ThemeMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Light => "light",
            Self::Dark => "dark",
            Self::Custom => "custom",
        }
    }

    /// Reads a stored value. Anything unknown falls back to `System`.
    pub fn from_stored(value: &str) -> Self {
        match value {
            "light" => Self::Light,
            "dark" => Self::Dark,
            "custom" => Self::Custom,
            _ => Self::System,
        }
    }
}

/// How opaque glass is. `Clear` is plain liquid glass, `Tinted` more opaque.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GlassStyle {
    Clear,
    Tinted,
}

impl GlassStyle {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Clear => "clear",
            Self::Tinted => "tinted",
        }
    }

    /// Reads a stored value. Anything unknown falls back to `Clear`.
    pub fn from_stored(value: &str) -> Self {
        match value {
            "tinted" => Self::Tinted,
            _ => Self::Clear,
        }
    }
}

/// The most color slots one swatch list holds. The client decides how many it
/// shows; this only bounds what is stored.
pub const MAX_SWATCHES: usize = 24;

/// One swatch list: each slot a `#rrggbb` color or `None` for an empty slot.
pub type Swatches = Vec<Option<String>>;

/// A partial change. `None` leaves a field alone. For the nullable colors,
/// `Some(None)` clears the field back to the app default.
#[derive(Debug, Default)]
pub struct SettingsPatch {
    pub theme_mode: Option<ThemeMode>,
    pub accent_color: Option<Option<String>>,
    pub background_color: Option<Option<String>>,
    pub glass_tint: Option<Option<String>>,
    pub glass_style: Option<GlassStyle>,
    /// `Some(None)` resets the list to the presets.
    pub accent_swatches: Option<Option<Swatches>>,
    pub glass_tint_swatches: Option<Option<Swatches>>,
    pub tag_color_swatches: Option<Option<Swatches>>,
    pub background_swatches: Option<Option<Swatches>>,
    pub hide_explicit: Option<bool>,
    pub show_suggested_tags: Option<bool>,
}

/// The settings a user with no row gets. Matches the column defaults in
/// `sql/user_settings.sql`.
fn default_settings(user_id: Uuid) -> user_settings::Model {
    user_settings::Model {
        user_id,
        theme_mode: ThemeMode::System.as_str().to_owned(),
        accent_color: None,
        background_color: None,
        glass_tint: None,
        glass_style: GlassStyle::Clear.as_str().to_owned(),
        accent_swatches: None,
        glass_tint_swatches: None,
        tag_color_swatches: None,
        background_swatches: None,
        hide_explicit: false,
        show_suggested_tags: true,
        updated_at: Utc::now().fixed_offset(),
    }
}

/// Returns the user's settings, or the defaults when they have never changed one.
pub async fn get_settings(
    db: &DatabaseConnection,
    user_id: Uuid,
) -> Result<user_settings::Model, CadenzaError> {
    Ok(user_settings::Entity::find_by_id(user_id)
        .one(db)
        .await?
        .unwrap_or_else(|| default_settings(user_id)))
}

/// Applies `patch` and returns the full settings after it. Creates the row on
/// the first change. `InvalidRequestBody` when the patch is empty or a value is
/// out of range.
pub async fn update_settings(
    db: &DatabaseConnection,
    user_id: Uuid,
    patch: SettingsPatch,
) -> Result<user_settings::Model, CadenzaError> {
    // every column starts unset, so the upsert writes only what the patch names
    let mut row = user_settings::ActiveModel {
        user_id: Set(user_id),
        updated_at: Set(Utc::now().fixed_offset()),
        ..Default::default()
    };

    if let Some(mode) = patch.theme_mode {
        row.theme_mode = Set(mode.as_str().to_owned());
    }
    if let Some(color) = patch.accent_color {
        row.accent_color = Set(color.as_deref().map(check_hex_color).transpose()?);
    }
    if let Some(color) = patch.background_color {
        row.background_color = Set(color.as_deref().map(check_hex_color).transpose()?);
    }
    if let Some(color) = patch.glass_tint {
        row.glass_tint = Set(color.as_deref().map(check_hex_color).transpose()?);
    }
    if let Some(style) = patch.glass_style {
        row.glass_style = Set(style.as_str().to_owned());
    }
    if let Some(swatches) = patch.accent_swatches {
        row.accent_swatches = Set(swatches.map(check_swatches).transpose()?);
    }
    if let Some(swatches) = patch.glass_tint_swatches {
        row.glass_tint_swatches = Set(swatches.map(check_swatches).transpose()?);
    }
    if let Some(swatches) = patch.tag_color_swatches {
        row.tag_color_swatches = Set(swatches.map(check_swatches).transpose()?);
    }
    if let Some(swatches) = patch.background_swatches {
        row.background_swatches = Set(swatches.map(check_swatches).transpose()?);
    }
    if let Some(hide) = patch.hide_explicit {
        row.hide_explicit = Set(hide);
    }
    if let Some(show) = patch.show_suggested_tags {
        row.show_suggested_tags = Set(show);
    }

    // updated_at is always set, so it alone means the patch named nothing
    let changed = changed_columns(&row);
    if changed.len() == 1 {
        return Err(CadenzaError::InvalidRequestBody(
            "set at least one setting".to_string(),
        ));
    }

    Ok(user_settings::Entity::insert(row)
        .on_conflict(
            OnConflict::column(Column::UserId)
                .update_columns(changed)
                .to_owned(),
        )
        .exec_with_returning(db)
        .await?)
}

/// The columns `row` sets besides the key, so a conflict updates only those.
fn changed_columns(row: &user_settings::ActiveModel) -> Vec<Column> {
    Column::iter()
        .filter(|column| !matches!(column, Column::UserId) && row.get(*column).is_set())
        .collect()
}

/// Returns `#rrggbb` lowercased, or `InvalidRequestBody` for anything else.
fn check_hex_color(color: &str) -> Result<String, CadenzaError> {
    let color = color.trim().to_ascii_lowercase();
    let valid = color.len() == 7
        && color.starts_with('#')
        && color[1..].chars().all(|c| c.is_ascii_hexdigit());

    if valid {
        Ok(color)
    } else {
        Err(CadenzaError::InvalidRequestBody(format!(
            "colors must be #rrggbb, got '{color}'"
        )))
    }
}

/// Returns the list as stored json with every color lowercased, or
/// `InvalidRequestBody` for more than [`MAX_SWATCHES`] slots or a bad color.
fn check_swatches(swatches: Swatches) -> Result<serde_json::Value, CadenzaError> {
    if swatches.len() > MAX_SWATCHES {
        return Err(CadenzaError::InvalidRequestBody(format!(
            "a swatch list holds at most {MAX_SWATCHES} slots"
        )));
    }
    let checked = swatches
        .iter()
        .map(|slot| slot.as_deref().map(check_hex_color).transpose())
        .collect::<Result<Swatches, _>>()?;
    Ok(serde_json::json!(checked))
}

/// A stored swatch list, or `None` when it is unset or not shaped like one.
pub fn read_swatches(stored: Option<&serde_json::Value>) -> Option<Swatches> {
    serde_json::from_value(stored?.clone()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_hex_color_lowercases_and_rejects_other_shapes() {
        assert_eq!(check_hex_color(" #FF3B30 ").unwrap(), "#ff3b30");
        assert!(check_hex_color("ff3b30").is_err());
        assert!(check_hex_color("#fff").is_err());
        assert!(check_hex_color("#ff3b3g").is_err());
    }

    #[test]
    fn glass_style_round_trips_and_defaults_unknown_to_clear() {
        for style in [GlassStyle::Clear, GlassStyle::Tinted] {
            assert_eq!(GlassStyle::from_stored(style.as_str()), style);
        }
        assert_eq!(GlassStyle::from_stored("frosted"), GlassStyle::Clear);
    }

    #[test]
    fn theme_mode_round_trips_and_defaults_unknown_to_system() {
        for mode in [
            ThemeMode::System,
            ThemeMode::Light,
            ThemeMode::Dark,
            ThemeMode::Custom,
        ] {
            assert_eq!(ThemeMode::from_stored(mode.as_str()), mode);
        }
        assert_eq!(ThemeMode::from_stored("sepia"), ThemeMode::System);
    }

    #[test]
    fn check_swatches_keeps_empty_slots_and_lowercases() {
        let stored = check_swatches(vec![Some("#FF9F0A".to_owned()), None]).unwrap();
        assert_eq!(stored, serde_json::json!(["#ff9f0a", null]));
        assert_eq!(
            read_swatches(Some(&stored)),
            Some(vec![Some("#ff9f0a".to_owned()), None])
        );
        assert!(check_swatches(vec![Some("red".to_owned())]).is_err());
        assert!(check_swatches(vec![None; MAX_SWATCHES + 1]).is_err());
        assert_eq!(read_swatches(Some(&serde_json::json!({"a": 1}))), None);
    }

    #[test]
    fn changed_columns_lists_only_what_is_set() {
        let mut row = user_settings::ActiveModel {
            updated_at: Set(Utc::now().fixed_offset()),
            ..Default::default()
        };
        assert!(matches!(changed_columns(&row)[..], [Column::UpdatedAt]));
        row.user_id = Set(Uuid::nil());
        row.accent_color = Set(None);
        let changed = changed_columns(&row);
        assert_eq!(changed.len(), 2);
        assert!(changed.iter().any(|c| matches!(c, Column::AccentColor)));
        assert!(!changed.iter().any(|c| matches!(c, Column::UserId)));
    }
}

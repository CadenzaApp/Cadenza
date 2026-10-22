use serde::{Deserialize, Deserializer, Serialize};

use crate::db::{
    entity::user_settings,
    settings::{GlassStyle, SettingsPatch, Swatches, ThemeMode, read_swatches},
};

/// The signed-in user's settings as the api returns them.
#[derive(Serialize)]
pub struct UserSettings {
    pub theme_mode: ThemeMode,
    /// `#rrggbb`, or null for the app default.
    pub accent_color: Option<String>,
    /// `#rrggbb` the custom mode draws, or null for none chosen.
    pub background_color: Option<String>,
    /// `#rrggbb`, or null for untinted glass.
    pub glass_tint: Option<String>,
    pub glass_style: GlassStyle,
    /// Color slots, `#rrggbb` or null for empty. Null for the presets.
    pub accent_swatches: Option<Swatches>,
    pub glass_tint_swatches: Option<Swatches>,
    pub tag_color_swatches: Option<Swatches>,
    pub background_swatches: Option<Swatches>,
    pub hide_explicit: bool,
    pub show_suggested_tags: bool,
}

impl From<user_settings::Model> for UserSettings {
    fn from(model: user_settings::Model) -> Self {
        Self {
            theme_mode: ThemeMode::from_stored(&model.theme_mode),
            accent_color: model.accent_color,
            background_color: model.background_color,
            glass_tint: model.glass_tint,
            glass_style: GlassStyle::from_stored(&model.glass_style),
            accent_swatches: read_swatches(model.accent_swatches.as_ref()),
            glass_tint_swatches: read_swatches(model.glass_tint_swatches.as_ref()),
            tag_color_swatches: read_swatches(model.tag_color_swatches.as_ref()),
            background_swatches: read_swatches(model.background_swatches.as_ref()),
            hide_explicit: model.hide_explicit,
            show_suggested_tags: model.show_suggested_tags,
        }
    }
}

/// `PATCH /settings` body. Every field is optional. A missing key is left
/// alone. `null` resets a color or slot list, and is ignored on the other
/// fields.
#[derive(Deserialize, Default)]
pub struct PatchUserSettings {
    pub theme_mode: Option<ThemeMode>,
    #[serde(default, deserialize_with = "present")]
    pub accent_color: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    pub background_color: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    pub glass_tint: Option<Option<String>>,
    pub glass_style: Option<GlassStyle>,
    #[serde(default, deserialize_with = "present")]
    pub accent_swatches: Option<Option<Swatches>>,
    #[serde(default, deserialize_with = "present")]
    pub glass_tint_swatches: Option<Option<Swatches>>,
    #[serde(default, deserialize_with = "present")]
    pub tag_color_swatches: Option<Option<Swatches>>,
    #[serde(default, deserialize_with = "present")]
    pub background_swatches: Option<Option<Swatches>>,
    pub hide_explicit: Option<bool>,
    pub show_suggested_tags: Option<bool>,
}

/// Wraps a key that is present, null included, in `Some`. A missing key falls
/// to `#[serde(default)]` and stays `None`.
fn present<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

impl From<PatchUserSettings> for SettingsPatch {
    fn from(body: PatchUserSettings) -> Self {
        Self {
            theme_mode: body.theme_mode,
            accent_color: body.accent_color,
            background_color: body.background_color,
            glass_tint: body.glass_tint,
            glass_style: body.glass_style,
            accent_swatches: body.accent_swatches,
            glass_tint_swatches: body.glass_tint_swatches,
            tag_color_swatches: body.tag_color_swatches,
            background_swatches: body.background_swatches,
            hide_explicit: body.hide_explicit,
            show_suggested_tags: body.show_suggested_tags,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn patch_tells_missing_from_null() {
        let body: PatchUserSettings =
            serde_json::from_value(json!({ "accent_color": null })).unwrap();
        assert_eq!(body.accent_color, Some(None));
        assert_eq!(body.glass_tint, None);

        let body: PatchUserSettings =
            serde_json::from_value(json!({ "glass_tint": "#112233" })).unwrap();
        assert_eq!(body.glass_tint, Some(Some("#112233".to_owned())));
    }

    #[test]
    fn patch_rejects_unknown_theme_mode() {
        assert!(
            serde_json::from_value::<PatchUserSettings>(json!({ "theme_mode": "sepia" })).is_err()
        );
    }
}

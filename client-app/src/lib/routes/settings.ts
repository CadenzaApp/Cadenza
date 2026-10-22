import { useAPIData, useAPIMutation } from "../api-actions";

/** Custom draws `background_color`, with light or dark text picked from it. */
export type ThemeMode = "system" | "light" | "dark" | "custom";

/** Clear is plain liquid glass, tinted more opaque, as in iOS 26.1 Settings. */
export type GlassStyle = "clear" | "tinted";

/** The signed-in user's private settings, from `GET /settings`. */
export type UserSettings = {
    theme_mode: ThemeMode;
    /** `#rrggbb`, or null for the app default accent. */
    accent_color: string | null;
    /** `#rrggbb` the custom mode draws, or null for none picked. */
    background_color: string | null;
    /** `#rrggbb`, or null for untinted glass. */
    glass_tint: string | null;
    glass_style: GlassStyle;
    /** Color slots, `#rrggbb` or null for empty. Null for the presets. */
    accent_swatches: (string | null)[] | null;
    glass_tint_swatches: (string | null)[] | null;
    tag_color_swatches: (string | null)[] | null;
    background_swatches: (string | null)[] | null;
    hide_explicit: boolean;
    /** Suggested tag pills under songs in music lists. */
    show_suggested_tags: boolean;
};

/** A missing key is left alone. `null` resets a color to its default. */
export type UserSettingsPatch = Partial<UserSettings>;

/** What the backend returns for a user with no row. Also used signed out. */
export const DEFAULT_USER_SETTINGS: UserSettings = {
    theme_mode: "system",
    accent_color: null,
    background_color: null,
    glass_tint: null,
    glass_style: "clear",
    accent_swatches: null,
    glass_tint_swatches: null,
    tag_color_swatches: null,
    background_swatches: null,
    hide_explicit: false,
    show_suggested_tags: true,
};

/**
 * The signed-in user's settings, never undefined: the defaults stand in until
 * the first response, and the last response is saved on the device so a cold
 * start opens with the right theme. `updateSettings` applies the change at
 * once and rolls it back if the PATCH fails.
 */
export function useUserSettings() {
    const x = useAPIData<UserSettings>("/settings", undefined, { save: true });
    const patch = useAPIMutation<UserSettingsPatch, UserSettings>(
        "PATCH",
        "/settings",
        [],
        { invalidation: "none" },
    );

    const settings = x.data ?? DEFAULT_USER_SETTINGS;

    async function updateSettings(change: UserSettingsPatch) {
        // revalidate so the saved copy on the device picks up the change
        return x.mutate(patch.trigger(change), {
            optimisticData: { ...settings, ...change },
            rollbackOnError: true,
            populateCache: true,
            revalidate: true,
        });
    }

    return {
        settings,
        settingsLoading: x.isLoading,
        settingsErr: x.error,
        updateSettings,
        updateSettingsErr: patch.error,
    };
}

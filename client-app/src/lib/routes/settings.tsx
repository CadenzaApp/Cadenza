import {
    createContext,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from "react";

import { useAccount } from "../account";
import { useAPIData, useAPIMutation } from "../api-actions";

/** Custom draws `background_color`, with light or dark text picked from it. */
export type ThemeMode = "system" | "light" | "dark" | "custom";

/** Clear is plain liquid glass, tinted more opaque. */
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

/**
 * A missing key is left alone. `null` resets a color or a swatch list to its
 * default, and is ignored on the other fields.
 */
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

/** How long a cold start waits for settings before drawing the defaults. */
const SETTINGS_HOLD_MS = 1500;

type UserSettingsState = {
    /** Never undefined: the defaults stand in until a value has loaded. */
    settings: UserSettings;
    /** True once a real value is in hand, from the device or the backend. */
    settingsLoaded: boolean;
    /**
     * True once `settings` is worth drawing: loaded, failed, signed out, or
     * held for `SETTINGS_HOLD_MS`. Gate first paints on this, not on loaded.
     */
    settingsReady: boolean;
    settingsErr: unknown;
    updateSettings: (change: UserSettingsPatch) => Promise<unknown>;
    updateSettingsErr: unknown;
};

const UserSettingsContext = createContext<UserSettingsState | null>(null);

/**
 * Reads `/settings` once for the whole app. The last value is saved on the
 * device, so a cold start opens with the right theme. `updateSettings`
 * applies the change at once and rolls it back if the PATCH fails.
 *
 * Mounted under `AccountProvider`, since settings are per account.
 */
export function UserSettingsProvider({ children }: { children: ReactNode }) {
    const { account } = useAccount();
    const accountId = account?.id ?? null;
    const x = useAPIData<UserSettings>("/settings", undefined, { save: true });
    const patch = useAPIMutation<UserSettingsPatch, UserSettings>(
        "PATCH",
        "/settings",
        [],
        { invalidation: "none" },
    );

    const settingsLoaded = x.data !== undefined;
    // a slow first read on a new device draws the defaults rather than
    // holding the app back for good
    const [heldFor, setHeldFor] = useState<string | null>(null);
    useEffect(() => {
        if (!accountId || settingsLoaded) return;
        const timer = setTimeout(() => setHeldFor(accountId), SETTINGS_HOLD_MS);
        return () => clearTimeout(timer);
    }, [accountId, settingsLoaded]);
    const settingsReady =
        !accountId ||
        settingsLoaded ||
        x.error !== undefined ||
        heldFor === accountId;

    const settings = x.data ?? DEFAULT_USER_SETTINGS;

    async function updateSettings(change: UserSettingsPatch) {
        // the PATCH returns the whole row, so no GET after it. built from the
        // cache at call time, so two changes in one tick both stick
        return x.mutate(patch.trigger(change), {
            optimisticData: (current) => ({
                ...(current ?? settings),
                ...change,
            }),
            rollbackOnError: true,
            populateCache: true,
            revalidate: false,
        });
    }

    return (
        <UserSettingsContext.Provider
            value={{
                settings,
                settingsLoaded,
                settingsReady,
                settingsErr: x.error,
                updateSettings,
                updateSettingsErr: patch.error,
            }}
        >
            {children}
        </UserSettingsContext.Provider>
    );
}

/** The signed-in user's settings. See `UserSettingsProvider`. */
export function useUserSettings(): UserSettingsState {
    const state = useContext(UserSettingsContext);
    if (!state)
        throw new Error("useUserSettings requires UserSettingsProvider.");
    return state;
}

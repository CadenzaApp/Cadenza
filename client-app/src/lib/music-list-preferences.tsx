import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, type ReactNode } from "react";

import { useAccount } from "./account";
import { useUserSettings } from "./routes/settings";

/** Where this preference lived before it moved to `/settings`. */
const LEGACY_SHOW_SUGGESTED_TAGS_KEY = "cadenza.music-list.show-suggested-tags";

/**
 * Presentation choices shared by every music list, read from the user's
 * settings. `showSuggestedTags` only hides suggested pills in list rows.
 */
export function useMusicListPreferences() {
    const { settings, updateSettings } = useUserSettings();

    return {
        showSuggestedTags: settings.show_suggested_tags,
        setShowSuggestedTags: (show: boolean) =>
            void updateSettings({ show_suggested_tags: show }).catch((error) =>
                console.error(
                    "Failed to save music-list tag preference:",
                    error,
                ),
            ),
    };
}

/**
 * Moves a device-local "off" from before `/settings` existed onto the
 * account once, then forgets it. Renders only its children.
 */
export function MusicListPreferencesProvider({
    children,
}: {
    children: ReactNode;
}) {
    const { account } = useAccount();
    const { settingsLoaded, updateSettings } = useUserSettings();

    useEffect(() => {
        // waits for the account's own settings, so the change lands on them
        if (!account || !settingsLoaded) return;
        void (async () => {
            try {
                const stored = await AsyncStorage.getItem(
                    LEGACY_SHOW_SUGGESTED_TAGS_KEY,
                );
                if (stored === null) return;
                if (stored === "false")
                    await updateSettings({ show_suggested_tags: false });
                await AsyncStorage.removeItem(LEGACY_SHOW_SUGGESTED_TAGS_KEY);
            } catch (error) {
                console.error(
                    "Failed to move music-list tag preference:",
                    error,
                );
            }
        })();
        // once per signed-in account. the stored value is gone after the
        // first run, so a later run returns early
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [account?.id, settingsLoaded]);

    return children;
}

import { GlassToggle } from "@/components/ui/glass-toggle";
import { useAccount } from "@/lib/account";
import { useSaveSettings } from "@/lib/routes/settings";

import {
    SettingsGroup,
    SettingsRow,
    SettingsSheet,
    SaveError,
} from "./settings-ui";

/**
 * Tag suggestions, the explicit content filter, and whether saved queries
 * follow tagging. Saved to the account.
 */
export function ListeningPreferencesScreen() {
    const { account } = useAccount();
    const { settings, save, saveErr } = useSaveSettings("listening preference");

    if (!account) {
        // SignOutHandler is already taking them to login
        return null;
    }

    return (
        <SettingsSheet title="Listening">
            <SettingsGroup>
                <SettingsRow
                    icon="sparkles-outline"
                    title="Tag suggestions"
                    description="Show suggested tags under songs in lists."
                    trailing={
                        <GlassToggle
                            value={settings.show_suggested_tags}
                            onValueChange={(show) =>
                                save({ show_suggested_tags: show })
                            }
                            accessibilityLabel="Show suggested tags in music lists"
                        />
                    }
                />
                <SettingsRow
                    icon="eye-off-outline"
                    title="Hide explicit content"
                    description="Filter explicit songs and albums out of lists, queries, and playback."
                    trailing={
                        <GlassToggle
                            value={settings.hide_explicit}
                            onValueChange={(hide) =>
                                save({ hide_explicit: hide })
                            }
                            accessibilityLabel="Hide explicit content"
                        />
                    }
                />
            </SettingsGroup>
            <SettingsGroup>
                <SettingsRow
                    icon="funnel-outline"
                    title="Update saved queries"
                    description="When you tag a song, add it to any saved query it now matches. Off, a saved query only changes when you rerun it."
                    trailing={
                        <GlassToggle
                            value={settings.auto_update_queries}
                            onValueChange={(auto) =>
                                save({ auto_update_queries: auto })
                            }
                            accessibilityLabel="Update saved queries when tagging"
                        />
                    }
                />
            </SettingsGroup>
            <SaveError error={saveErr} />
        </SettingsSheet>
    );
}

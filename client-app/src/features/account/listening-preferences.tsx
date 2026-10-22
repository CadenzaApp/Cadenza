import { Redirect } from "expo-router";

import { GlassToggle } from "@/components/ui/glass-toggle";
import { useAccount } from "@/lib/account";
import { useSaveSettings } from "@/lib/routes/settings";

import {
    SettingsGroup,
    SettingsRow,
    SettingsSheet,
    SaveError,
} from "./settings-ui";

/** Tag suggestions and the explicit content filter. Saved to the account. */
export function ListeningPreferencesScreen() {
    const { account } = useAccount();
    const { settings, save, saveErr } = useSaveSettings("listening preference");

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
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
            <SaveError error={saveErr} />
        </SettingsSheet>
    );
}

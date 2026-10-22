import { Redirect } from "expo-router";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DetailScreen } from "@/components/ui/detail-screen";
import { GlassToggle } from "@/components/ui/glass-toggle";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useUserSettings } from "@/lib/routes/settings";

import { SettingsGroup, SettingsRow } from "./settings-ui";

/** Tag suggestions and the explicit content filter. Saved to the account. */
export function ListeningPreferencesScreen() {
    const insets = useSafeAreaInsets();
    const { account } = useAccount();
    const { settings, updateSettings, updateSettingsErr } = useUserSettings();

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
    }

    function save(change: Parameters<typeof updateSettings>[0]) {
        void updateSettings(change).catch((error) =>
            console.error("Failed to save listening preference:", error),
        );
    }

    return (
        <DetailScreen presentation="sheet" title="Listening">
            <ScrollView
                className="flex-1"
                contentContainerClassName="gap-4 px-5 pt-2"
                contentContainerStyle={{
                    paddingBottom: Math.max(insets.bottom, 16) + 16,
                }}
                showsVerticalScrollIndicator={false}
            >
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
                {updateSettingsErr ? (
                    <Text className="px-2 text-sm text-destructive">
                        Could not save that change. Please try again.
                    </Text>
                ) : null}
            </ScrollView>
        </DetailScreen>
    );
}

import { View } from "react-native";

import { GlassPanel } from "@/components/ui/glass-panel";
import { Text } from "@/components/ui/text";

import { SettingsIcon, type IoniconName, SettingsSheet } from "./settings-ui";

type PrivacyPoint = { icon: IoniconName; title: string; body: string };

const POINTS: PrivacyPoint[] = [
    {
        icon: "shield-checkmark-outline",
        title: "We do not sell your data",
        body: "Nothing you store in Cadenza is sold or shared for ads.",
    },
    {
        icon: "musical-notes-outline",
        title: "Apple Music stays with Apple",
        body: "Your Apple Music sign in lives on this device. Cadenza servers never see your Apple account details.",
    },
    {
        icon: "server-outline",
        title: "What Cadenza keeps",
        body: "The songs in your library by id, the tags you apply, your queries, your listening history for Analytics, your settings, and anything you post on Social.",
    },
];

/** What Cadenza stores and what it does not. Read only. */
export function PrivacySettingsScreen() {
    return (
        <SettingsSheet title="Privacy & data">
            {POINTS.map((point) => (
                <GlassPanel key={point.title}>
                    <View className="flex-row gap-3.5 px-4 py-4">
                        <SettingsIcon name={point.icon} />
                        <View className="flex-1 gap-1">
                            <Text className="text-base font-semibold">
                                {point.title}
                            </Text>
                            <Text className="text-sm leading-5 text-muted-foreground">
                                {point.body}
                            </Text>
                        </View>
                    </View>
                </GlassPanel>
            ))}
        </SettingsSheet>
    );
}

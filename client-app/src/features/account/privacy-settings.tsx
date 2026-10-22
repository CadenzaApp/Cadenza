import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DetailScreen } from "@/components/ui/detail-screen";
import { Text } from "@/components/ui/text";

import {
    GlassSettingsPanel,
    SettingsIcon,
    type IoniconName,
} from "./settings-ui";

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
    const insets = useSafeAreaInsets();

    return (
        <DetailScreen presentation="sheet" title="Privacy & data">
            <ScrollView
                className="flex-1"
                contentContainerClassName="gap-4 px-5 pt-2"
                contentContainerStyle={{
                    paddingBottom: Math.max(insets.bottom, 16) + 16,
                }}
                showsVerticalScrollIndicator={false}
            >
                {POINTS.map((point) => (
                    <GlassSettingsPanel key={point.title}>
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
                    </GlassSettingsPanel>
                ))}
            </ScrollView>
        </DetailScreen>
    );
}

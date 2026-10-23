import { useRouter, type Href } from "expo-router";

import {
    SettingsPoints,
    SettingsSheet,
    type SettingsPoint,
} from "./settings-ui";

/** What Cadenza stores and what it does not. Read only. */
export function PrivacySettingsScreen() {
    const router = useRouter();
    const points: SettingsPoint[] = [
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
            body: "The songs in your library by id, the tags you apply, your listening history for Analytics, your settings, and anything you post on Social.",
        },
        {
            icon: "trash-outline",
            title: "See or delete it any time",
            body: "All personal data collected is listed at:\nAccount details > Your data\nView or delete all your data from there.",
            onPress: () => router.push("/your-data" as Href),
        },
    ];

    return (
        <SettingsSheet title="Privacy & data">
            <SettingsPoints points={points} />
        </SettingsSheet>
    );
}

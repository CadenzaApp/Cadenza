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
            body: "Account details > Your data lists everything Cadenza keeps about you, and lets you delete all of it.",
            onPress: () => router.push("/your-data" as Href),
        },
    ];

    return (
        <SettingsSheet title="Privacy & data">
            <SettingsPoints points={points} />
        </SettingsSheet>
    );
}

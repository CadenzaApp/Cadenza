import { useRouter, type Href } from "expo-router";

import {
    SegmentedControl,
    type SegmentOption,
} from "@/components/ui/segmented-control";
import {
    usePrivacySettings,
    type Audience,
    type PrivacySettings,
} from "@/lib/routes/privacy";

import {
    SaveError,
    SettingsPoints,
    SettingsSection,
    SettingsSheet,
    type SettingsPoint,
} from "./settings-ui";

const AUDIENCES: readonly SegmentOption<Audience>[] = [
    { value: "nobody", label: "Off", icon: "eye-off-outline" },
    { value: "friends", label: "Friends", icon: "people-outline" },
    { value: "everyone", label: "Everyone", icon: "globe-outline" },
];

/** One picker per privacy setting, in the order they show. */
const FIELDS: readonly {
    field: keyof PrivacySettings;
    title: string;
    footnote: string;
}[] = [
    {
        field: "now_playing",
        title: "Now playing",
        footnote: "Who sees the song you are playing right now.",
    },
    {
        field: "listening_history",
        title: "Recent plays",
        footnote: "Who sees your recent plays on your profile.",
    },
    {
        field: "session_join",
        title: "Live sessions",
        footnote: "Who can join your live session without a code.",
    },
    {
        field: "playlist_add",
        title: "Shared playlists",
        footnote: "Who can add you to a shared playlist without a code.",
    },
    {
        field: "listen_along",
        title: "Listen along",
        footnote:
            "When you play music, a live session starts on its own so these people can listen with you.",
    },
];

/** Who sees your listening, then what Cadenza stores and what it does not. */
export function PrivacySettingsScreen() {
    const router = useRouter();
    const { privacy, updatePrivacy, updatePrivacyErr } = usePrivacySettings();

    function save(change: Partial<PrivacySettings>) {
        void updatePrivacy(change).catch((error) =>
            console.error("Failed to save privacy:", error),
        );
    }

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
            body: "The songs in your library by id, the tags you apply, your listening history for Analytics, what you are playing now, your settings, and anything you post on Social.",
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
            {FIELDS.map(({ field, title, footnote }) => (
                <SettingsSection key={field} title={title} footnote={footnote}>
                    <SegmentedControl
                        options={AUDIENCES}
                        value={privacy[field]}
                        onChange={(audience) => save({ [field]: audience })}
                    />
                </SettingsSection>
            ))}
            <SaveError error={updatePrivacyErr} />
            <SettingsSection title="Your data">
                <SettingsPoints points={points} />
            </SettingsSection>
        </SettingsSheet>
    );
}

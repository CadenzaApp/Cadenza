import { useState } from "react";

import {
    OptionPicker,
    type PickerOption,
} from "@/components/custom/option-picker";
import { Text } from "@/components/ui/text";
import {
    usePrivacySettings,
    type Audience,
    type PrivacySettings,
} from "@/lib/routes/privacy";

import {
    SaveError,
    SettingsGroup,
    SettingsRow,
    SettingsSection,
    SettingsSheet,
    type IoniconName,
} from "./settings-ui";

const AUDIENCES: readonly (PickerOption & { key: Audience })[] = [
    { key: "nobody", label: "Off", icon: "eye-off-outline" },
    { key: "friends", label: "Friends", icon: "people-outline" },
    { key: "everyone", label: "Everyone", icon: "globe-outline" },
];

type Field = {
    field: keyof PrivacySettings;
    icon: IoniconName;
    title: string;
    description: string;
};

/** The privacy settings, grouped, in the order they show. */
const GROUPS: readonly {
    title: string;
    footnote?: string;
    fields: readonly Field[];
}[] = [
    {
        title: "Your listening",
        footnote:
            "Listen along starts a live session, which stays open until you end it.",
        fields: [
            {
                field: "now_playing",
                icon: "musical-note-outline",
                title: "Now playing",
                description: "The song you are playing right now",
            },
            {
                field: "listening_history",
                icon: "time-outline",
                title: "Recent plays",
                description: "Your recent plays, on your profile",
            },
            {
                field: "listen_along",
                icon: "headset-outline",
                title: "Listen along",
                description: "Who can join you from Listening now",
            },
        ],
    },
    {
        title: "Joining you",
        footnote: "Anyone can still join with a code.",
        fields: [
            {
                field: "session_join",
                icon: "radio-outline",
                title: "Live sessions",
                description: "Who can join your live session",
            },
            {
                field: "playlist_add",
                icon: "person-add-outline",
                title: "Shared playlists",
                description: "Who can add you to one",
            },
        ],
    },
    {
        title: "Your profile",
        footnote: "Opening a shared playlist still needs an invite.",
        fields: [
            {
                field: "profile_playlists",
                icon: "albums-outline",
                title: "Shared playlists",
                description: "Who sees them on your profile",
            },
            {
                field: "profile_queries",
                icon: "funnel-outline",
                title: "Saved queries",
                description: "Who sees the ones you share, and their songs",
            },
        ],
    },
];

function audienceLabel(audience: Audience) {
    return AUDIENCES.find((option) => option.key === audience)?.label;
}

/**
 * Who sees your listening and your profile, and who can join you or add you,
 * one row per privacy setting.
 */
export function SharingSettingsScreen() {
    const { privacy, updatePrivacy, updatePrivacyErr } = usePrivacySettings();
    // the setting whose picker is open
    const [picking, setPicking] = useState<Field | null>(null);

    function save(change: Partial<PrivacySettings>) {
        void updatePrivacy(change).catch((error) =>
            console.error("Failed to save privacy:", error),
        );
    }

    return (
        <SettingsSheet
            title="Sharing"
            overlay={
                <OptionPicker
                    visible={picking !== null}
                    title={picking?.title ?? ""}
                    sections={[{ options: [...AUDIENCES] }]}
                    selectedKey={picking ? privacy[picking.field] : null}
                    onSelect={(key) => {
                        const audience = AUDIENCES.find(
                            (option) => option.key === key,
                        )?.key;
                        if (picking && audience) {
                            save({ [picking.field]: audience });
                        }
                        setPicking(null);
                    }}
                    onClose={() => setPicking(null)}
                />
            }
        >
            {GROUPS.map((group) => (
                <SettingsSection
                    key={group.title}
                    title={group.title}
                    footnote={group.footnote}
                >
                    <SettingsGroup>
                        {group.fields.map((field) => (
                            <SettingsRow
                                key={field.field}
                                icon={field.icon}
                                title={field.title}
                                description={field.description}
                                accessibilityLabel={`${field.title}, ${audienceLabel(privacy[field.field])}`}
                                onPress={() => setPicking(field)}
                                trailing={
                                    <Text className="text-base text-muted-foreground">
                                        {audienceLabel(privacy[field.field])}
                                    </Text>
                                }
                                chevron
                            />
                        ))}
                    </SettingsGroup>
                </SettingsSection>
            ))}
            <SaveError error={updatePrivacyErr} />
        </SettingsSheet>
    );
}

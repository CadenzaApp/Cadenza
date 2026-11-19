import Ionicons from "@expo/vector-icons/Ionicons";

import { useState } from "react";
import { Pressable, View } from "react-native";

import { GlassConfirmDialog } from "@/components/ui/glass-confirm-dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Text } from "@/components/ui/text";
import { formatCount, formatDuration } from "@/features/analytics/format";
import { useAccount } from "@/lib/account";
import { useUserData, type UserDataCount } from "@/lib/routes/profile";
import {
    usePrivacySettings,
    type Audience,
    type PrivacySettings,
} from "@/lib/routes/privacy";
import { useUserSettings, type UserSettings } from "@/lib/routes/settings";
import { useAppTheme } from "@/lib/theme";

import { memberSince, useAccountIdentity } from "./account-avatar";
import { SettingsGroup, SettingsSheet } from "./settings-ui";

type DataValue = { text: string; color?: string | null };

const SECTION_TITLES: Record<UserDataCount["section"], string> = {
    library: "Library",
    tags: "Tags",
    listening: "Listening",
    social: "Social",
    social_listening: "Social listening",
};

const AUDIENCE_LABELS: Record<Audience, string> = {
    nobody: "Off",
    friends: "Friends",
    everyone: "Everyone",
};

function audience(value: Audience): DataValue {
    return { text: AUDIENCE_LABELS[value] };
}

/**
 * Every privacy setting and how it reads. Keyed by `PrivacySettings`, so a
 * new one does not compile until it is listed here.
 */
const PRIVACY_ROWS: {
    [K in keyof PrivacySettings]: {
        label: string;
        show: (value: PrivacySettings[K]) => DataValue;
    };
} = {
    now_playing: { label: "Now playing", show: audience },
    listening_history: { label: "Recent plays", show: audience },
    session_join: { label: "Join your live sessions", show: audience },
    playlist_add: { label: "Add you to shared playlists", show: audience },
    listen_along: { label: "Listen along", show: audience },
    profile_playlists: { label: "Playlists on your profile", show: audience },
    profile_queries: { label: "Queries on your profile", show: audience },
};

function color(hex: string | null, unset: string): DataValue {
    return hex ? { text: hex, color: hex } : { text: unset };
}

function onOff(on: boolean): DataValue {
    return { text: on ? "On" : "Off" };
}

function swatches(slots: (string | null)[] | null): DataValue {
    if (!slots) return { text: "Default" };
    const saved = slots.filter((slot) => slot !== null).length;
    return { text: `${saved} ${saved === 1 ? "color" : "colors"}` };
}

/**
 * Every saved setting and how it reads. Keyed by `UserSettings`, so a new
 * setting does not compile until it is listed here.
 */
const SETTING_ROWS: {
    [K in keyof UserSettings]: {
        label: string;
        show: (value: UserSettings[K]) => DataValue;
    };
} = {
    theme_mode: { label: "Mode", show: (mode) => ({ text: capitalize(mode) }) },
    accent_color: { label: "Accent", show: (hex) => color(hex, "Default") },
    background_color: {
        label: "Background",
        show: (hex) => color(hex, "None picked"),
    },
    glass_tint: { label: "Glass tint", show: (hex) => color(hex, "None") },
    glass_style: {
        label: "Glass",
        show: (style) => ({ text: capitalize(style) }),
    },
    accent_swatches: { label: "Saved accents", show: swatches },
    glass_tint_swatches: { label: "Saved glass tints", show: swatches },
    background_swatches: { label: "Saved backgrounds", show: swatches },
    tag_color_swatches: { label: "Saved tag colors", show: swatches },
    hide_explicit: { label: "Hide explicit content", show: onOff },
    show_suggested_tags: { label: "Tag suggestions", show: onOff },
    auto_update_queries: { label: "Update saved queries", show: onOff },
};

/**
 * Everything Cadenza keeps about the signed-in user, as tables: profile,
 * counts from `GET /profile/data`, and saved settings. Ends with Delete
 * account, which is not wired up yet.
 */
export function YourDataScreen() {
    const { account } = useAccount();
    const { profile } = useAccountIdentity();
    const { settings } = useUserSettings();
    const { privacy } = usePrivacySettings();
    const { userData, userDataErr } = useUserData(Boolean(account));
    const [confirmOpen, setConfirmOpen] = useState(false);

    if (!account) {
        // SignOutHandler is already taking them to login
        return null;
    }

    const profileRows: [string, DataValue][] = [
        ["Email", { text: account.email }],
        ["Member since", { text: memberSince(account.createdAt) }],
        ["Username", { text: profile?.username ?? "-" }],
        ["Bio", { text: profile?.bio.trim() || "None" }],
    ];
    const settingRows = tableRows(SETTING_ROWS, settings);
    const privacyRows = tableRows(PRIVACY_ROWS, privacy);

    return (
        <SettingsSheet
            title="Your data"
            className="gap-6"
            overlay={
                <GlassConfirmDialog
                    open={confirmOpen}
                    title="Delete your Cadenza account?"
                    description="This permanently removes your profile, tags, listening history, settings, and posts from Cadenza. It cannot be undone. Your Apple Music library is not touched."
                    confirmLabel="Delete"
                    pendingLabel="Deleting..."
                    onOpenChange={setConfirmOpen}
                    // not wired up yet, so confirming only closes the dialog
                    onConfirm={() => setConfirmOpen(false)}
                />
            }
        >
            <Text className="px-2 text-sm leading-5 text-muted-foreground">
                Everything Cadenza stores about you. Song titles and artwork
                come from Apple Music and are not stored with your account.
            </Text>

            <DataTable title="Profile" rows={profileRows} />

            {userData ? (
                groupBySection(userData).map(([section, counts]) => (
                    <DataTable
                        key={section}
                        title={SECTION_TITLES[section]}
                        rows={counts.map((count) => [
                            count.description,
                            { text: formatValue(count) },
                        ])}
                    />
                ))
            ) : (
                <GlassPanel>
                    <Text className="p-4 text-sm text-muted-foreground">
                        {userDataErr
                            ? "Could not load your data."
                            : "Loading..."}
                    </Text>
                </GlassPanel>
            )}

            <DataTable title="Settings" rows={settingRows} />
            <DataTable title="Privacy" rows={privacyRows} />

            <DeleteAccountButton onPress={() => setConfirmOpen(true)} />
        </SettingsSheet>
    );
}

/** A table's rows from a registry keyed like the values it reads. */
function tableRows<T extends object>(
    registry: {
        [K in keyof T]: { label: string; show: (value: T[K]) => DataValue };
    },
    values: T,
): [string, DataValue][] {
    return (Object.keys(registry) as (keyof T)[]).map((key) => {
        const row = registry[key];
        return [row.label, row.show(values[key])];
    });
}

/**
 * A panel of label and value rows, closed to its title until tapped. The
 * chevron points down while it is open.
 */
function DataTable({
    title,
    rows,
}: {
    title: string;
    rows: [string, DataValue][];
}) {
    const { colors } = useAppTheme();
    const [open, setOpen] = useState(false);
    return (
        <SettingsGroup>
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${title}, ${rows.length} rows`}
                onPress={() => setOpen((current) => !current)}
                className="flex-row items-center px-4 py-3.5 active:opacity-60"
            >
                <Text className="flex-1 text-base font-semibold">{title}</Text>
                <Ionicons
                    name={open ? "chevron-down" : "chevron-forward"}
                    size={18}
                    color={colors.mutedForeground}
                />
            </Pressable>
            {open
                ? rows.map(([label, value]) => (
                      <DataRow key={label} label={label} value={value} />
                  ))
                : null}
        </SettingsGroup>
    );
}

function DataRow({ label, value }: { label: string; value: DataValue }) {
    return (
        <View
            className="flex-row items-center gap-4 px-4 py-3"
            accessible
            accessibilityLabel={`${label}, ${value.text}`}
        >
            <Text className="flex-1 text-base">{label}</Text>
            <View className="max-w-[60%] flex-row items-center gap-2">
                {value.color ? (
                    <View
                        className="h-4 w-4 rounded-full border border-border"
                        style={{ backgroundColor: value.color }}
                    />
                ) : null}
                <Text
                    className="shrink text-right text-base text-muted-foreground"
                    numberOfLines={3}
                >
                    {value.text}
                </Text>
            </View>
        </View>
    );
}

function DeleteAccountButton({ onPress }: { onPress: () => void }) {
    const { colors } = useAppTheme();

    return (
        <Pressable
            accessibilityRole="button"
            onPress={onPress}
            hitSlop={8}
            className="flex-row items-center justify-center gap-2.5 py-3 active:opacity-60"
        >
            <Ionicons
                name="trash-outline"
                size={22}
                color={colors.destructive}
            />
            <Text className="text-base font-semibold text-destructive">
                Delete account and all data
            </Text>
        </Pressable>
    );
}

/** The counts in their server order, grouped by section in first-seen order. */
function groupBySection(
    counts: UserDataCount[],
): [UserDataCount["section"], UserDataCount[]][] {
    const groups = new Map<UserDataCount["section"], UserDataCount[]>();
    for (const count of counts) {
        const group = groups.get(count.section) ?? [];
        group.push(count);
        groups.set(count.section, group);
    }
    return [...groups];
}

function formatValue(count: UserDataCount): string {
    return count.unit === "milliseconds"
        ? formatDuration(count.value)
        : formatCount(count.value);
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

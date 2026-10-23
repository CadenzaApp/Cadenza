import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { GlassConfirmDialog } from "@/components/ui/glass-confirm-dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Text } from "@/components/ui/text";
import { formatCount, formatDuration } from "@/features/analytics/format";
import { useAccount } from "@/lib/account";
import { useUserData, type UserDataCount } from "@/lib/routes/profile";
import { useUserSettings, type UserSettings } from "@/lib/routes/settings";
import { useAppTheme } from "@/lib/theme";

import { memberSince, useAccountIdentity } from "./account-avatar";
import { SettingsGroup, SettingsSection, SettingsSheet } from "./settings-ui";

type DataValue = { text: string; color?: string | null };

const SECTION_TITLES: Record<UserDataCount["section"], string> = {
    library: "Library",
    tags: "Tags",
    listening: "Listening",
    social: "Social",
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
    const { userData, userDataErr } = useUserData(Boolean(account));
    const [confirmOpen, setConfirmOpen] = useState(false);

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
    }

    const profileRows: [string, DataValue][] = [
        ["Email", { text: account.email }],
        ["Member since", { text: memberSince(account.createdAt) }],
        ["Username", { text: profile?.username ?? "-" }],
        ["Bio", { text: profile?.bio.trim() || "None" }],
    ];
    const settingRows = (
        Object.keys(SETTING_ROWS) as (keyof UserSettings)[]
    ).map((key): [string, DataValue] => {
        const row = SETTING_ROWS[key] as {
            label: string;
            show: (value: unknown) => DataValue;
        };
        return [row.label, row.show(settings[key])];
    });

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

            <DeleteAccountButton onPress={() => setConfirmOpen(true)} />
        </SettingsSheet>
    );
}

/** A titled panel of label and value rows. */
function DataTable({
    title,
    rows,
}: {
    title: string;
    rows: [string, DataValue][];
}) {
    return (
        <SettingsSection title={title}>
            <SettingsGroup>
                {rows.map(([label, value]) => (
                    <DataRow key={label} label={label} value={value} />
                ))}
            </SettingsGroup>
        </SettingsSection>
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

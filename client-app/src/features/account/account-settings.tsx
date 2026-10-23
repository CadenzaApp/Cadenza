import { Redirect, useRouter, type Href } from "expo-router";
import { Pressable, View } from "react-native";

import { AppleMusicLogo } from "@/components/custom/apple-music-logo";
import { GlassPanel } from "@/components/ui/glass-panel";
import { GlassPill } from "@/components/ui/glass-pill";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { useUserSettings, type ThemeMode } from "@/lib/routes/settings";
import { useAppleMusicSync } from "@/lib/song-init";

import { AccountAvatar, useAccountIdentity } from "./account-avatar";
import {
    appleMusicStatus,
    useConnectAppleMusic,
    useLastSyncedLabel,
} from "./apple-music-connection";
import {
    SettingsChevron,
    SettingsGroup,
    SettingsRow,
    SettingsSheet,
    SettingsTile,
    StatusDot,
    type IoniconName,
} from "./settings-ui";

const THEME_MODE_LABEL: Record<ThemeMode, string> = {
    system: "System",
    light: "Light",
    dark: "Dark",
    custom: "Custom",
};

const THEME_MODE_ICON: Record<ThemeMode, IoniconName> = {
    system: "contrast-outline",
    light: "sunny-outline",
    dark: "moon-outline",
    custom: "color-palette-outline",
};

/**
 * The account sheet: who you are, the Apple Music connection, and the way into
 * every other settings sheet. The header opens account details; each card and
 * tile opens its own sheet.
 */
export function AccountSettingsScreen() {
    const router = useRouter();
    const { account } = useAccount();
    const { settings } = useUserSettings();
    const { displayName, initial } = useAccountIdentity();

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
    }

    return (
        <SettingsSheet title="Account">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${displayName}, ${account.email}`}
                accessibilityHint="Opens account details"
                onPress={() => router.push("/account-details" as Href)}
                className="items-center gap-1 pb-3 active:opacity-60"
            >
                <AccountAvatar initial={initial} />
                <Text
                    className="mt-3 text-center text-2xl font-bold"
                    numberOfLines={1}
                >
                    {displayName}
                </Text>
                <Text
                    className="text-center text-base text-muted-foreground"
                    numberOfLines={1}
                >
                    {account.email}
                </Text>
                {/* the whole header opens the details, so the pill is
                    only a cue and stays out of the touch and VoiceOver tree */}
                <View
                    className="mt-3"
                    pointerEvents="none"
                    importantForAccessibility="no-hide-descendants"
                    accessibilityElementsHidden
                >
                    <GlassPill
                        size="md"
                        icon="person-outline"
                        label="Account details"
                        chevron
                    />
                </View>
            </Pressable>

            <AppleMusicCard
                onOpen={() => router.push("/apple-music" as Href)}
            />

            <View className="flex-row gap-4">
                <SettingsTile
                    icon="pricetag-outline"
                    title="Listening preferences"
                    subtitle="Tags & explicit content"
                    onPress={() =>
                        router.push("/listening-preferences" as Href)
                    }
                />
                <SettingsTile
                    icon={THEME_MODE_ICON[settings.theme_mode]}
                    title="Appearance"
                    subtitle={THEME_MODE_LABEL[settings.theme_mode]}
                    onPress={() => router.push("/appearance" as Href)}
                />
            </View>

            <SettingsGroup>
                <SettingsRow
                    icon="shield-checkmark-outline"
                    title="Privacy & data"
                    chevron
                    onPress={() => router.push("/privacy" as Href)}
                />
                <SettingsRow
                    icon="information-circle-outline"
                    title="Apple Music limits"
                    description="What Apple does not let Cadenza do"
                    chevron
                    onPress={() => router.push("/apple-music-limits" as Href)}
                />
            </SettingsGroup>
        </SettingsSheet>
    );
}

/**
 * Apple Music at a glance. The top row says who and whether it is connected,
 * the bottom row when it last synced and the one action that fits the state.
 * The card opens the Apple Music sheet; the pill acts in place.
 */
function AppleMusicCard({ onOpen }: { onOpen: () => void }) {
    const { authResult, isInitializing, sessionExpired } = useAppleMusic();
    const { syncNow, isSyncing, canSync } = useAppleMusicSync();
    const { connectAppleMusic, isConnecting, message } = useConnectAppleMusic();
    const syncedLabel = useLastSyncedLabel();
    const status = appleMusicStatus(authResult, isInitializing, sessionExpired);

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Apple Music, ${status.label}`}
            accessibilityHint="Opens Apple Music settings"
            // VoiceOver merges the card into one element, so the pill's
            // action is offered on the card as well
            accessibilityActions={
                status.action === "sync"
                    ? [{ name: "sync", label: "Sync now" }]
                    : status.action
                      ? [{ name: "connect", label: "Connect" }]
                      : undefined
            }
            onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === "sync" && canSync)
                    void syncNow();
                if (event.nativeEvent.actionName === "connect")
                    void connectAppleMusic();
            }}
            onPress={onOpen}
            className="active:opacity-60"
        >
            <GlassPanel>
                <View className="gap-3 p-4">
                    <View className="flex-row items-center gap-3.5">
                        <AppleMusicLogo size={52} />
                        <View className="flex-1 gap-1">
                            <Text className="text-lg font-semibold">
                                Apple Music
                            </Text>
                            <View className="flex-row items-center gap-2">
                                <StatusDot tone={status.tone} />
                                <Text className="text-sm">{status.label}</Text>
                            </View>
                        </View>
                        <SettingsChevron />
                    </View>
                    {status.action ? (
                        <View className="flex-row items-center justify-between gap-3">
                            <Text
                                className="flex-1 text-sm text-muted-foreground"
                                numberOfLines={1}
                            >
                                {status.action === "sync"
                                    ? syncedLabel
                                    : (message ??
                                      "Connect to use your library")}
                            </Text>
                            {status.action === "sync" ? (
                                <GlassPill
                                    icon="sync-outline"
                                    label="Sync now"
                                    loading={isSyncing}
                                    disabled={!canSync}
                                    onPress={() => void syncNow()}
                                />
                            ) : (
                                <GlassPill
                                    icon="link-outline"
                                    label={
                                        status.action === "reconnect"
                                            ? "Reconnect"
                                            : "Connect"
                                    }
                                    loading={isConnecting}
                                    onPress={() => void connectAppleMusic()}
                                />
                            )}
                        </View>
                    ) : null}
                </View>
            </GlassPanel>
        </Pressable>
    );
}

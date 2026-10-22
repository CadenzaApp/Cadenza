import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getAccountInitials } from "@/components/custom/account-initials";
import { AppleMusicLogo } from "@/components/custom/apple-music-logo";
import { DetailScreen } from "@/components/ui/detail-screen";
import { GlassPill } from "@/components/ui/glass-pill";
import { GlassConfirmDialog } from "@/components/ui/glass-confirm-dialog";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { useProfile } from "@/lib/routes/profile";
import { useUserSettings, type ThemeMode } from "@/lib/routes/settings";
import { useAppleMusicSync } from "@/lib/song-init";
import { useAppTheme } from "@/lib/theme";
import { useOpenSocialProfile } from "@/lib/use-open-social-profile";

import {
    appleMusicStatus,
    useConnectAppleMusic,
    useLastSyncedLabel,
} from "./apple-music-connection";
import {
    GlassSettingsPanel,
    SettingsChevron,
    SettingsGroup,
    SettingsRow,
    SettingsTile,
    StatusDot,
    type IoniconName,
} from "./settings-ui";

const AVATAR_SIZE = 96;
/** How far below center the initial sits, as a share of the avatar. */
const INITIAL_NUDGE = 0.035;

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
 * every other settings sheet. Each tile and row opens its own sheet.
 */
export function AccountSettingsScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { account, signOut } = useAccount();
    const { profile } = useProfile(Boolean(account));
    const { settings } = useUserSettings();
    const openSocialProfile = useOpenSocialProfile();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [signingOut, setSigningOut] = useState(false);
    const [signOutError, setSignOutError] = useState<string | null>(null);

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
    }

    const emailName = account.email.split("@", 1)[0] ?? account.email;
    const displayName = profile?.username ?? emailName;
    const initial = profile?.username
        ? profile.username.charAt(0).toUpperCase()
        : getAccountInitials(account.email);

    function setConfirmation(open: boolean) {
        if (signingOut) return;
        setConfirmOpen(open);
        if (!open) setSignOutError(null);
    }

    async function handleSignOut() {
        if (signingOut) return;
        setSigningOut(true);
        setSignOutError(null);
        try {
            await signOut();
            setConfirmOpen(false);
            router.replace("/auth?initialMode=signin");
        } catch (error) {
            console.error("Account sign-out error:", error);
            setSignOutError("Could not sign out. Please try again.");
        } finally {
            setSigningOut(false);
        }
    }

    return (
        <DetailScreen presentation="sheet" title="Account">
            <ScrollView
                className="flex-1"
                contentContainerClassName="gap-4 px-5 pt-2"
                contentContainerStyle={{
                    paddingBottom: Math.max(insets.bottom, 16) + 16,
                }}
                showsVerticalScrollIndicator={false}
            >
                <View className="items-center gap-1 pb-3">
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
                    <View className="mt-3">
                        <GlassPill
                            size="md"
                            icon="person-outline"
                            label="View public profile"
                            chevron
                            onPress={() => openSocialProfile(account.id)}
                        />
                    </View>
                </View>

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
                        icon="person-outline"
                        title="Account details"
                        chevron
                        onPress={() => router.push("/account-details" as Href)}
                    />
                </SettingsGroup>

                <SignOutButton onPress={() => setConfirmation(true)} />
            </ScrollView>

            <GlassConfirmDialog
                open={confirmOpen}
                title="Sign out of Cadenza?"
                description="You will need to sign in again to use Cadenza."
                confirmLabel="Sign Out"
                pendingLabel="Signing out..."
                pending={signingOut}
                error={signOutError}
                onOpenChange={setConfirmation}
                onConfirm={() => void handleSignOut()}
            />
        </DetailScreen>
    );
}

/** A large accent circle with the user's initial. */
function AccountAvatar({ initial }: { initial: string }) {
    const { colors } = useAppTheme();

    return (
        <View
            className="items-center justify-center overflow-hidden rounded-full"
            style={{
                width: AVATAR_SIZE,
                height: AVATAR_SIZE,
                backgroundColor: colors.brand,
            }}
        >
            {/* a soft highlight from the top, so the flat fill reads round */}
            <LinearGradient
                pointerEvents="none"
                colors={["rgba(255,255,255,0.28)", "rgba(255,255,255,0)"]}
                style={StyleSheet.absoluteFill}
            />
            {/* a capital sits high in its line box, so nudge it down to
                look centered in the circle */}
            <Text
                className="text-5xl font-bold"
                style={{
                    color: colors.brandForeground,
                    transform: [{ translateY: AVATAR_SIZE * INITIAL_NUDGE }],
                    includeFontPadding: false,
                }}
            >
                {initial}
            </Text>
        </View>
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
            accessibilityLabel="Open Apple Music settings"
            onPress={onOpen}
            className="active:opacity-60"
        >
            <GlassSettingsPanel>
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
            </GlassSettingsPanel>
        </Pressable>
    );
}

function SignOutButton({ onPress }: { onPress: () => void }) {
    const { colors } = useAppTheme();

    return (
        <Pressable
            accessibilityRole="button"
            onPress={onPress}
            hitSlop={8}
            className="flex-row items-center justify-center gap-2.5 py-4 active:opacity-60"
        >
            <Ionicons
                name="log-out-outline"
                size={22}
                color={colors.destructive}
            />
            <Text className="text-base font-semibold text-destructive">
                Sign out of Cadenza
            </Text>
        </Pressable>
    );
}

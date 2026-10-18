import { AuthStatus, type AuthResult } from "@apple-musickit";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, useRouter, type Href } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    TextInput,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getAccountInitials } from "@/components/custom/account-initials";
import { DetailScreen } from "@/components/ui/detail-screen";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassConfirmDialog } from "@/components/ui/glass-confirm-dialog";
import { GlassSurface } from "@/components/ui/glass-surface";
import { GlassToggle } from "@/components/ui/glass-toggle";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { classifyError } from "@/lib/app-error";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { useMusicListPreferences } from "@/lib/music-list-preferences";
import { useProfile, useUpdateProfile } from "@/lib/routes/profile";

import { GlassSettingsPanel, SettingsIcon, SettingsRow } from "./settings-ui";

/** Matches `MAX_USERNAME_CHARS` in backend-api/src/db/profile.rs. */
const MAX_USERNAME_CHARS = 64;
/** Matches `MAX_BIO_CHARS` in backend-api/src/db/profile.rs. */
const MAX_BIO_CHARS = 500;

type ConfirmationTarget = "cadenza" | "apple-music";

export function AccountSettingsScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();
    const { account, signOut } = useAccount();
    const { profile, profileLoading, profileErr } = useProfile();
    const { updateProfile, updateProfileLoading, resetUpdateProfile } =
        useUpdateProfile();
    const { showSuggestedTags, setShowSuggestedTags } =
        useMusicListPreferences();
    const {
        authResult,
        isInitializing,
        isConnected,
        sessionExpired,
        connect,
        disconnect,
    } = useAppleMusic();
    const [hideExplicitContent, setHideExplicitContent] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [confirmationTarget, setConfirmationTarget] =
        useState<ConfirmationTarget | null>(null);
    const [isConfirming, setIsConfirming] = useState(false);
    const [confirmationError, setConfirmationError] = useState<string | null>(
        null,
    );
    const [connectionMessage, setConnectionMessage] = useState<string | null>(
        null,
    );
    const [syncMessageVisible, setSyncMessageVisible] = useState(false);
    const [username, setUsername] = useState("");
    const [bio, setBio] = useState("");
    const [profileSaveError, setProfileSaveError] = useState<string | null>(
        null,
    );
    const [profileSaveMessage, setProfileSaveMessage] = useState<string | null>(
        null,
    );
    const profileFormSeeded = useRef(false);

    useEffect(() => {
        if (!profile || profileFormSeeded.current) return;
        setUsername(profile.username);
        setBio(profile.bio);
        profileFormSeeded.current = true;
    }, [profile]);

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
    }

    const trimmedUsername = username.trim();
    const trimmedBio = bio.trim();
    const profileDirty =
        profile != null &&
        (trimmedUsername !== profile.username || trimmedBio !== profile.bio);
    const usernameValid =
        trimmedUsername.length > 0 &&
        trimmedUsername.length <= MAX_USERNAME_CHARS &&
        !trimmedUsername.includes("@");
    const bioValid = trimmedBio.length <= MAX_BIO_CHARS;
    const canSaveProfile =
        profileDirty &&
        usernameValid &&
        bioValid &&
        !updateProfileLoading &&
        !profileLoading;

    async function handleSaveProfile() {
        if (!canSaveProfile) return;

        setProfileSaveError(null);
        setProfileSaveMessage(null);
        resetUpdateProfile();
        try {
            const updated = await updateProfile({
                username: trimmedUsername,
                bio: trimmedBio,
            });
            setUsername(updated.username);
            setBio(updated.bio);
            setProfileSaveMessage("Profile saved.");
        } catch (error) {
            console.error("Profile save error:", error);
            setProfileSaveError(profileSaveErrorMessage(error));
        }
    }

    async function handleConnectAppleMusic() {
        setIsConnecting(true);
        setConnectionMessage(null);
        try {
            const result = await connect();
            if (!result) return;

            if (result.status === AuthStatus.Authorized && result.userToken) {
                setConnectionMessage("Apple Music connected.");
                return;
            }

            setConnectionMessage(connectionFailureMessage(result));
        } catch (error) {
            console.error("Apple Music connection error:", error);
            setConnectionMessage(
                "Could not connect Apple Music. Please try again.",
            );
        } finally {
            setIsConnecting(false);
        }
    }

    function openConfirmation(target: ConfirmationTarget) {
        setConfirmationError(null);
        setConfirmationTarget(target);
    }

    function setConfirmationOpen(open: boolean) {
        if (isConfirming) return;
        if (!open) {
            setConfirmationTarget(null);
            setConfirmationError(null);
        }
    }

    async function handleConfirmSignOut() {
        if (!confirmationTarget || isConfirming) return;

        setIsConfirming(true);
        setConfirmationError(null);
        try {
            if (confirmationTarget === "cadenza") {
                await signOut();
                setConfirmationTarget(null);
                router.replace("/auth?initialMode=signin");
                return;
            }

            await disconnect();
            setConfirmationTarget(null);
            setConnectionMessage("Apple Music signed out.");
        } catch (error) {
            console.error("Account sign-out error:", error);
            setConfirmationError("Could not sign out. Please try again.");
        } finally {
            setIsConfirming(false);
        }
    }

    const confirmation = confirmationCopy(confirmationTarget);

    return (
        <DetailScreen presentation="sheet" title="Account">
            <ScrollView
                className="flex-1"
                contentContainerClassName="gap-4 px-5 pt-3"
                contentContainerStyle={{
                    paddingBottom: Math.max(insets.bottom, 16) + 16,
                }}
                showsVerticalScrollIndicator={false}
            >
                <GlassSettingsPanel>
                    <View className="gap-5 px-5 py-5">
                        <View className="flex-row items-center gap-4">
                            <View className="h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-border">
                                <View
                                    pointerEvents="none"
                                    style={StyleSheet.absoluteFill}
                                >
                                    <GlassSurface
                                        variant="regular"
                                        style={StyleSheet.absoluteFill}
                                    />
                                </View>
                                <Text className="text-xl font-semibold text-destructive">
                                    {getAccountInitials(account.email)}
                                </Text>
                            </View>
                            <View className="flex-1 gap-1">
                                <Text className="text-lg font-semibold">
                                    Cadenza Account
                                </Text>
                                <Text
                                    className="text-sm text-muted-foreground"
                                    numberOfLines={1}
                                >
                                    {account.email}
                                </Text>
                            </View>
                        </View>
                        <GlassButton
                            variant="destructive"
                            className="w-full"
                            onPress={() => openConfirmation("cadenza")}
                        >
                            <Ionicons
                                name="log-out-outline"
                                size={19}
                                color={colors.notification}
                            />
                            <Text>Sign Out</Text>
                        </GlassButton>
                    </View>
                </GlassSettingsPanel>

                <GlassSettingsPanel>
                    <View className="gap-4 px-5 py-5">
                        <View className="gap-1">
                            <Text className="text-lg font-semibold">
                                Profile
                            </Text>
                            <Text className="text-sm leading-5 text-muted-foreground">
                                Your public username and bio on Cadenza.
                            </Text>
                        </View>

                        {profileLoading && !profile ? (
                            <ActivityIndicator
                                size="small"
                                color={colors.text}
                            />
                        ) : profileErr && !profile ? (
                            <Text className="text-sm text-destructive">
                                Could not load your profile. Try again later.
                            </Text>
                        ) : (
                            <>
                                <View className="gap-1.5">
                                    <Label>Username</Label>
                                    <Input
                                        value={username}
                                        onChangeText={(text) => {
                                            setUsername(
                                                text.slice(
                                                    0,
                                                    MAX_USERNAME_CHARS,
                                                ),
                                            );
                                            setProfileSaveError(null);
                                            setProfileSaveMessage(null);
                                        }}
                                        placeholder="username"
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        maxLength={MAX_USERNAME_CHARS}
                                        editable={!updateProfileLoading}
                                        returnKeyType="next"
                                    />
                                    <Text className="text-right text-xs text-muted-foreground">
                                        {username.trim().length}/
                                        {MAX_USERNAME_CHARS}
                                    </Text>
                                </View>

                                <View className="gap-1.5">
                                    <Label>Bio</Label>
                                    <View className="overflow-hidden rounded-md border border-border">
                                        <TextInput
                                            value={bio}
                                            onChangeText={(text) => {
                                                setBio(
                                                    text.slice(
                                                        0,
                                                        MAX_BIO_CHARS,
                                                    ),
                                                );
                                                setProfileSaveError(null);
                                                setProfileSaveMessage(null);
                                            }}
                                            placeholder="Say something about yourself"
                                            placeholderTextColor="#888888"
                                            multiline
                                            maxLength={MAX_BIO_CHARS}
                                            editable={!updateProfileLoading}
                                            textAlignVertical="top"
                                            className="min-h-[96px] bg-input px-3 py-3 text-base text-foreground"
                                        />
                                    </View>
                                    <Text className="text-right text-xs text-muted-foreground">
                                        {bio.trim().length}/{MAX_BIO_CHARS}
                                    </Text>
                                </View>

                                {profileSaveError ? (
                                    <Text className="text-sm text-destructive">
                                        {profileSaveError}
                                    </Text>
                                ) : null}
                                {profileSaveMessage ? (
                                    <Text className="text-sm text-muted-foreground">
                                        {profileSaveMessage}
                                    </Text>
                                ) : null}

                                <GlassButton
                                    className="w-full"
                                    disabled={!canSaveProfile}
                                    onPress={() => void handleSaveProfile()}
                                >
                                    {updateProfileLoading ? (
                                        <ActivityIndicator
                                            size="small"
                                            color={colors.text}
                                        />
                                    ) : (
                                        <Ionicons
                                            name="checkmark-outline"
                                            size={19}
                                            color={colors.text}
                                        />
                                    )}
                                    <Text>
                                        {updateProfileLoading
                                            ? "Saving..."
                                            : "Save Profile"}
                                    </Text>
                                </GlassButton>
                            </>
                        )}
                    </View>
                </GlassSettingsPanel>

                <GlassSettingsPanel>
                    <View className="gap-5 px-5 py-5">
                        <View className="flex-row items-center gap-4">
                            <SettingsIcon
                                name="musical-notes"
                                color={colors.notification}
                            />
                            <View className="flex-1 gap-1">
                                <Text className="text-lg font-semibold">
                                    Apple Music
                                </Text>
                                <Text
                                    className={`text-sm ${appleMusicStatusClass(authResult, isInitializing)}`}
                                >
                                    {appleMusicStatusLabel(
                                        authResult,
                                        isInitializing,
                                    )}
                                </Text>
                                {sessionExpired && !connectionMessage ? (
                                    <Text className="text-sm leading-5 text-destructive">
                                        Your Apple Music token expired.
                                        Reconnect to keep using your library.
                                    </Text>
                                ) : null}
                                {connectionMessage ? (
                                    <Text className="text-sm leading-5 text-muted-foreground">
                                        {connectionMessage}
                                    </Text>
                                ) : null}
                            </View>
                        </View>

                        {isConnected ? (
                            <GlassButton
                                variant="destructive"
                                className="w-full"
                                onPress={() => openConfirmation("apple-music")}
                            >
                                <Ionicons
                                    name="log-out-outline"
                                    size={19}
                                    color={colors.notification}
                                />
                                <Text>Sign Out</Text>
                            </GlassButton>
                        ) : (
                            <GlassButton
                                className="w-full"
                                disabled={isConnecting || isInitializing}
                                onPress={() => void handleConnectAppleMusic()}
                            >
                                {isConnecting ? (
                                    <ActivityIndicator
                                        size="small"
                                        color={colors.text}
                                    />
                                ) : (
                                    <Ionicons
                                        name="link-outline"
                                        size={19}
                                        color={colors.text}
                                    />
                                )}
                                <Text>
                                    {isConnecting
                                        ? "Connecting..."
                                        : "Connect Apple Music"}
                                </Text>
                            </GlassButton>
                        )}
                    </View>
                </GlassSettingsPanel>

                <GlassSettingsPanel>
                    <SettingsRow
                        icon="sparkles-outline"
                        title="Tag Suggestions in Lists"
                        description="Show suggested tags beneath songs in music lists."
                        trailing={
                            <GlassToggle
                                value={showSuggestedTags}
                                onValueChange={setShowSuggestedTags}
                                accessibilityLabel="Show suggested tags in music lists"
                            />
                        }
                    />
                </GlassSettingsPanel>

                <GlassSettingsPanel>
                    <SettingsRow
                        icon="eye-off-outline"
                        title="Hide Explicit Content"
                        description="Songs flagged as explicit will be hidden."
                        todo
                        trailing={
                            <GlassToggle
                                value={hideExplicitContent}
                                onValueChange={setHideExplicitContent}
                                accessibilityLabel="Hide explicit content"
                            />
                        }
                    />
                </GlassSettingsPanel>

                <GlassSettingsPanel>
                    <SettingsRow
                        icon="color-palette-outline"
                        title="Appearance"
                        description="Customize Cadenza colors and liquid glass tint."
                        todo
                        onPress={() => router.push("/appearance" as Href)}
                        accessibilityLabel="Open appearance settings"
                        trailing={
                            <Ionicons
                                name="chevron-forward"
                                size={20}
                                color={colors.text}
                            />
                        }
                    />
                </GlassSettingsPanel>

                <GlassSettingsPanel>
                    <SettingsRow
                        icon="shield-checkmark-outline"
                        title="Privacy"
                        description="Cadenza does not sell your data. Apple Music account details are never stored on Cadenza servers."
                    />
                </GlassSettingsPanel>

                <GlassSettingsPanel>
                    <View className="gap-3 px-5 py-5">
                        <SettingsRow
                            icon="sync-outline"
                            title="Sync Apple Music"
                            description="Force a fresh update from Apple Music."
                            todo
                        />
                        <GlassButton
                            className="w-full"
                            onPress={() => setSyncMessageVisible(true)}
                        >
                            <Ionicons
                                name="sync-outline"
                                size={19}
                                color={colors.text}
                            />
                            <Text>Sync Now</Text>
                        </GlassButton>
                        {syncMessageVisible ? (
                            <Text className="text-center text-sm text-muted-foreground">
                                Sync is not available yet.
                            </Text>
                        ) : null}
                    </View>
                </GlassSettingsPanel>
            </ScrollView>

            <GlassConfirmDialog
                open={confirmationTarget !== null}
                title={confirmation.title}
                description={confirmation.description}
                confirmLabel="Sign Out"
                pendingLabel="Signing out..."
                pending={isConfirming}
                error={confirmationError}
                onOpenChange={setConfirmationOpen}
                onConfirm={() => void handleConfirmSignOut()}
            />
        </DetailScreen>
    );
}

function appleMusicStatusLabel(
    result: AuthResult | null,
    initializing: boolean,
): string {
    if (initializing) return "Checking connection...";
    if (!result) return "Not Connected";

    switch (result.status) {
        case AuthStatus.Authorized:
            return result.userToken ? "Connected" : "Not Connected";
        case AuthStatus.Denied:
            return "Access Denied";
        case AuthStatus.Restricted:
            return "Restricted";
        case AuthStatus.NotDetermined:
            return "Not Connected";
        default:
            return "Unknown";
    }
}

function appleMusicStatusClass(
    result: AuthResult | null,
    initializing: boolean,
): string {
    if (initializing || !result) return "text-muted-foreground";

    switch (result.status) {
        case AuthStatus.Authorized:
            return result.userToken
                ? "text-green-500"
                : "text-muted-foreground";
        case AuthStatus.Denied:
            return "text-destructive";
        case AuthStatus.Restricted:
            return "text-orange-500";
        default:
            return "text-muted-foreground";
    }
}

function connectionFailureMessage(result: AuthResult): string {
    switch (result.status) {
        case AuthStatus.Denied:
            return "Apple Music access was denied.";
        case AuthStatus.Restricted:
            return "Apple Music access is restricted.";
        case AuthStatus.Authorized:
            return (
                result.error ??
                "Apple Music did not return an account token. Please try again."
            );
        default:
            return result.error ?? "Could not connect Apple Music.";
    }
}

function confirmationCopy(target: ConfirmationTarget | null) {
    if (target === "apple-music") {
        return {
            title: "Sign out of Apple Music?",
            description:
                "Cadenza will no longer access your Apple Music library until you reconnect.",
        };
    }

    return {
        title: "Sign out of Cadenza?",
        description: "You will need to sign in again to use Cadenza.",
    };
}

/** User-facing sentence for a failed profile save. */
function profileSaveErrorMessage(error: unknown): string {
    if (typeof error === "object" && error !== null) {
        const type = (error as { error_type?: unknown }).error_type;
        const message = (error as { message?: unknown }).message;

        if (type === "UsernameAlreadyTaken") {
            return "That username is already taken.";
        }
        if (
            (type === "QueryFormatError" || type === "InvalidRequestBody") &&
            typeof message === "string" &&
            message.length > 0
        ) {
            return sentenceCase(message);
        }
    }

    return classifyError(error).detail;
}

function sentenceCase(message: string): string {
    const trimmed = message.trim();
    if (!trimmed) return trimmed;
    const capped = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

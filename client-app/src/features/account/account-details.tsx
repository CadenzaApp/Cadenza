import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { GlassConfirmDialog } from "@/components/ui/glass-confirm-dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useAppTheme } from "@/lib/theme";
import { useOpenSocialProfile } from "@/lib/use-open-social-profile";

import {
    AccountAvatar,
    memberSince,
    useAccountIdentity,
} from "./account-avatar";
import { ProfileForm } from "./profile-form";
import {
    SettingsGroup,
    SettingsRow,
    SettingsSection,
    SettingsSheet,
} from "./settings-ui";

/**
 * The Cadenza account: who you are, the username and bio editor, the way into
 * Your data, and sign out. Opened from the Account sheet header and the Edit
 * button on your own public page.
 */
export function AccountDetailsScreen() {
    const router = useRouter();
    const { account, signOut } = useAccount();
    const { profile, profileLoading, displayName, initial } =
        useAccountIdentity();
    const openSocialProfile = useOpenSocialProfile();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [signingOut, setSigningOut] = useState(false);
    const [signOutError, setSignOutError] = useState<string | null>(null);

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
    }

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
        <SettingsSheet
            title="Account details"
            className="gap-6"
            overlay={
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
            }
        >
            <View className="flex-row items-center gap-4">
                <AccountAvatar initial={initial} size={64} />
                <View className="flex-1 gap-0.5">
                    <Text className="text-xl font-bold" numberOfLines={1}>
                        {displayName}
                    </Text>
                    <Text
                        className="text-sm text-muted-foreground"
                        numberOfLines={1}
                    >
                        Member since {memberSince(account.createdAt)}
                    </Text>
                </View>
            </View>

            <SettingsSection
                title="Social"
                footnote="Your username and bio show on your posts and your public page."
            >
                {profile ? (
                    <ProfileForm
                        key={`${profile.username}\n${profile.bio}`}
                        profile={profile}
                    />
                ) : (
                    <GlassPanel>
                        <Text className="p-4 text-sm text-muted-foreground">
                            {profileLoading
                                ? "Loading..."
                                : "Could not load your profile."}
                        </Text>
                    </GlassPanel>
                )}
                <SettingsGroup>
                    <SettingsRow
                        icon="person-outline"
                        title="View public profile"
                        chevron
                        onPress={() => openSocialProfile(account.id)}
                    />
                </SettingsGroup>
            </SettingsSection>

            <SettingsGroup>
                <SettingsRow
                    icon="server-outline"
                    title="Your data"
                    description={
                        "All the data Cadenza has on you.\nIt can be permanently deleted from here."
                    }
                    chevron
                    onPress={() => router.push("/your-data" as Href)}
                />
            </SettingsGroup>

            <SignOutButton onPress={() => setConfirmation(true)} />
        </SettingsSheet>
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

import { Redirect } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppleMusicLogo } from "@/components/custom/apple-music-logo";
import { DetailScreen } from "@/components/ui/detail-screen";
import { GlassPill } from "@/components/ui/glass-pill";
import { GlassConfirmDialog } from "@/components/ui/glass-confirm-dialog";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { useAppleMusicSync } from "@/lib/song-init";

import {
    appleMusicStatus,
    useConnectAppleMusic,
    useLastSyncedLabel,
} from "./apple-music-connection";
import {
    GlassSettingsPanel,
    SettingsGroup,
    SettingsRow,
    StatusDot,
} from "./settings-ui";

/** Apple Music connection: status, sync, connect, and disconnect. */
export function AppleMusicSettingsScreen() {
    const insets = useSafeAreaInsets();
    const { account } = useAccount();
    const {
        authResult,
        isInitializing,
        isConnected,
        sessionExpired,
        disconnect,
    } = useAppleMusic();
    const { syncNow, isSyncing, canSync } = useAppleMusicSync();
    const { connectAppleMusic, isConnecting, message, setMessage } =
        useConnectAppleMusic();
    const syncedLabel = useLastSyncedLabel();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [disconnectError, setDisconnectError] = useState<string | null>(null);

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
    }

    const status = appleMusicStatus(authResult, isInitializing, sessionExpired);

    function setConfirmation(open: boolean) {
        if (disconnecting) return;
        setConfirmOpen(open);
        if (!open) setDisconnectError(null);
    }

    async function handleDisconnect() {
        if (disconnecting) return;
        setDisconnecting(true);
        setDisconnectError(null);
        try {
            await disconnect();
            setConfirmOpen(false);
            setMessage("Apple Music signed out.");
        } catch (error) {
            console.error("Apple Music sign-out error:", error);
            setDisconnectError("Could not sign out. Please try again.");
        } finally {
            setDisconnecting(false);
        }
    }

    return (
        <DetailScreen presentation="sheet" title="Apple Music">
            <ScrollView
                className="flex-1"
                contentContainerClassName="gap-4 px-5 pt-2"
                contentContainerStyle={{
                    paddingBottom: Math.max(insets.bottom, 16) + 16,
                }}
                showsVerticalScrollIndicator={false}
            >
                <GlassSettingsPanel>
                    <View className="items-center gap-2 px-5 py-6">
                        <AppleMusicLogo size={64} />
                        <Text className="mt-1 text-xl font-semibold">
                            Apple Music
                        </Text>
                        <View className="flex-row items-center gap-2">
                            <StatusDot tone={status.tone} />
                            <Text className="text-base">{status.label}</Text>
                        </View>
                        {sessionExpired && !message ? (
                            <Text className="text-center text-sm leading-5 text-destructive">
                                Apple rejected the saved sign in. Reconnect to
                                keep using your library.
                            </Text>
                        ) : null}
                        {message ? (
                            <Text className="text-center text-sm leading-5 text-muted-foreground">
                                {message}
                            </Text>
                        ) : null}
                        {status.action === "connect" ||
                        status.action === "reconnect" ? (
                            <View className="mt-2">
                                <GlassPill
                                    size="md"
                                    icon="link-outline"
                                    label={
                                        status.action === "reconnect"
                                            ? "Reconnect Apple Music"
                                            : "Connect Apple Music"
                                    }
                                    loading={isConnecting}
                                    disabled={isInitializing}
                                    onPress={() => void connectAppleMusic()}
                                />
                            </View>
                        ) : null}
                    </View>
                </GlassSettingsPanel>

                {isConnected ? (
                    <SettingsGroup>
                        <SettingsRow
                            icon="sync-outline"
                            title="Library sync"
                            description={syncedLabel}
                            trailing={
                                <GlassPill
                                    icon="sync-outline"
                                    label="Sync now"
                                    loading={isSyncing}
                                    disabled={!canSync}
                                    onPress={() => void syncNow()}
                                />
                            }
                        />
                        <SettingsRow
                            icon="log-out-outline"
                            title="Disconnect Apple Music"
                            description="Cadenza stops reading your library until you reconnect."
                            destructive
                            onPress={() => setConfirmation(true)}
                        />
                    </SettingsGroup>
                ) : null}

                <Text className="px-2 text-sm leading-5 text-muted-foreground">
                    Sync reads your library and playlists from Apple Music and
                    updates what Cadenza queries search. It also runs on its own
                    each time you open the app.
                </Text>
            </ScrollView>

            <GlassConfirmDialog
                open={confirmOpen}
                title="Sign out of Apple Music?"
                description="Cadenza will no longer access your Apple Music library until you reconnect."
                confirmLabel="Sign Out"
                pendingLabel="Signing out..."
                pending={disconnecting}
                error={disconnectError}
                onOpenChange={setConfirmation}
                onConfirm={() => void handleDisconnect()}
            />
        </DetailScreen>
    );
}

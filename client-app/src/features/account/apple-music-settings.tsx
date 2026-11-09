import { useState } from "react";
import { View } from "react-native";

import { GlassPill } from "@/components/ui/glass-pill";
import { GlassConfirmDialog } from "@/components/ui/glass-confirm-dialog";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { useAppleMusicSync } from "@/lib/song-init";
import { logHandledError } from "@/lib/log";
import { APPLE_MUSIC_NEBULA } from "@/lib/theme";

import {
    AppleMusicBlurb,
    AppleMusicHero,
    AppleMusicUnlocks,
    ConnectAppleMusicActions,
    WhichAccountNote,
} from "./apple-music-connect-ui";
import {
    appleMusicStatus,
    useConnectAppleMusic,
    useLastSyncedLabel,
} from "./apple-music-connection";
import {
    SettingsGroup,
    SettingsRow,
    StatusDot,
    SettingsSheet,
} from "./settings-ui";

/** Apple Music connection: status, sync, connect, and disconnect. */
export function AppleMusicSettingsScreen() {
    const { account } = useAccount();
    const {
        authResult,
        isInitializing,
        isConnected,
        sessionExpired,
        disconnect,
    } = useAppleMusic();
    const { syncNow, isSyncing, canSync } = useAppleMusicSync();
    const { connectAppleMusic, isConnecting, message, setMessage, lastStatus } =
        useConnectAppleMusic();
    const syncedLabel = useLastSyncedLabel();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [disconnectError, setDisconnectError] = useState<string | null>(null);

    if (!account) {
        // SignOutHandler is already taking them to login
        return null;
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
            logHandledError("Apple Music sign-out error", error);
            setDisconnectError("Could not sign out. Please try again.");
        } finally {
            setDisconnecting(false);
        }
    }

    const canConnect =
        status.action === "connect" || status.action === "reconnect";
    const connectLabel =
        status.action === "reconnect"
            ? "Reconnect Apple Music"
            : "Connect Apple Music";

    return (
        <SettingsSheet
            // the hero carries the title, like the connect sheet
            title=""
            nebulaColors={APPLE_MUSIC_NEBULA}
            className="gap-6"
            overlay={
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
            }
        >
            <AppleMusicHero title="Apple Music">
                <View className="flex-row items-center gap-2">
                    <StatusDot tone={status.tone} />
                    <Text className="text-base">{status.label}</Text>
                </View>
                {sessionExpired && !message ? (
                    <AppleMusicBlurb>
                        Apple rejected the saved sign in. Reconnect to keep
                        using your library.
                    </AppleMusicBlurb>
                ) : null}
            </AppleMusicHero>

            {canConnect ? (
                <>
                    <AppleMusicUnlocks />
                    <ConnectAppleMusicActions
                        label={connectLabel}
                        onConnect={() => void connectAppleMusic()}
                        isConnecting={isConnecting}
                        disabled={isInitializing}
                        message={message}
                        lastStatus={lastStatus}
                    />
                    <WhichAccountNote />
                </>
            ) : null}

            {isConnected ? (
                <>
                    {message ? (
                        <AppleMusicBlurb>{message}</AppleMusicBlurb>
                    ) : null}
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
                    <Text className="px-2 text-sm leading-5 text-muted-foreground">
                        Sync reads your library and playlists from Apple Music
                        and updates what Cadenza queries search. It also runs on
                        its own each time you open the app.
                    </Text>
                </>
            ) : null}
        </SettingsSheet>
    );
}

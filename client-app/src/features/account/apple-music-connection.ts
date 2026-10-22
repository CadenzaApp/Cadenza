import { AuthStatus, type AuthResult } from "@apple-musickit";
import { useEffect, useState } from "react";

import { useAppleMusic } from "@/lib/apple-music-auth";
import { formatSyncedAgo } from "@/lib/last-synced";
import { useAppleMusicSync } from "@/lib/song-init";

import type { StatusTone } from "./settings-ui";

export type AppleMusicStatus = {
    label: string;
    tone: StatusTone;
    /** What the main action should be: sync, connect, reconnect, or none yet. */
    action: "sync" | "connect" | "reconnect" | null;
};

/** The connection state the Apple Music card and sheet show. */
export function appleMusicStatus(
    result: AuthResult | null,
    initializing: boolean,
    sessionExpired: boolean,
): AppleMusicStatus {
    if (initializing)
        return { label: "Checking...", tone: "idle", action: null };
    if (sessionExpired) {
        return { label: "Needs attention", tone: "bad", action: "reconnect" };
    }
    if (!result)
        return { label: "Not connected", tone: "idle", action: "connect" };

    switch (result.status) {
        case AuthStatus.Authorized:
            return result.userToken
                ? { label: "Connected", tone: "good", action: "sync" }
                : { label: "Not connected", tone: "idle", action: "connect" };
        case AuthStatus.Denied:
            return { label: "Access denied", tone: "bad", action: "connect" };
        case AuthStatus.Restricted:
            return { label: "Restricted", tone: "warn", action: null };
        case AuthStatus.Failed:
            return {
                label: "Connection failed",
                tone: "bad",
                action: "connect",
            };
        default:
            return { label: "Not connected", tone: "idle", action: "connect" };
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

/**
 * Connecting Apple Music from a settings screen. `message` is what the last
 * attempt said, success or failure, for the screen to show under the status.
 */
export function useConnectAppleMusic() {
    const { connect } = useAppleMusic();
    const [isConnecting, setIsConnecting] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    async function connectAppleMusic() {
        setIsConnecting(true);
        setMessage(null);
        try {
            const result = await connect();
            if (!result) return;
            setMessage(
                result.status === AuthStatus.Authorized && result.userToken
                    ? "Apple Music connected."
                    : connectionFailureMessage(result),
            );
        } catch (error) {
            console.error("Apple Music connection error:", error);
            setMessage("Could not connect Apple Music. Please try again.");
        } finally {
            setIsConnecting(false);
        }
    }

    return { connectAppleMusic, isConnecting, message, setMessage };
}

const LABEL_REFRESH_MS = 60_000;

/** "Syncing...", "Last synced 2 min ago", and so on. Re-renders each minute. */
export function useLastSyncedLabel(): string {
    const { isSyncing, lastSyncedAt, error } = useAppleMusicSync();
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), LABEL_REFRESH_MS);
        return () => clearInterval(timer);
    }, []);

    if (isSyncing) return "Syncing...";
    if (error) return error;
    if (lastSyncedAt === null) return "Not synced yet";
    // a sync that just finished is newer than the last tick
    return `Last synced ${formatSyncedAgo(lastSyncedAt, Math.max(now, lastSyncedAt))}`;
}

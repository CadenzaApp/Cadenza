import type { Href } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { GlassConfirmDialog } from "@/components/ui/glass-confirm-dialog";
import { Text } from "@/components/ui/text";
import { useOpenScreen } from "@/lib/open-screen";
import {
    useLiveSessionWrites,
    type LiveSession,
} from "@/lib/routes/live-sessions";
import { useAppTheme } from "@/lib/theme";
import { useMusicAccess } from "@/lib/use-music-access";

import { LiveChip } from "../social/LiveChip";
import { OptionRow, errorType } from "./session-parts";
import { useCurrentLiveSession } from "./use-current-session";
import { useStartSessionNow } from "./use-start-session-now";

/**
 * The player's LIVE button, where shuffle used to be. Outside a session it
 * starts one in a tap. In a session it lights up and opens the session's
 * menu: settings, listen mode, leave, and end.
 */
export function LiveButton() {
    const session = useCurrentLiveSession();
    const fullPlayback = useMusicAccess().can("fullPlayback");
    const { mutedForeground } = useAppTheme().colors;
    const { startSessionNow, startingSession } = useStartSessionNow();
    const [menuOpen, setMenuOpen] = useState(false);

    async function press() {
        if (session) {
            setMenuOpen(true);
            return;
        }
        if (!fullPlayback) {
            Alert.alert(
                "Live session",
                "Hosting a session needs an Apple Music subscription.",
            );
            return;
        }
        try {
            await startSessionNow();
        } catch {
            Alert.alert("Live session", "Couldn't start a session.");
        }
    }

    return (
        <>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                    session
                        ? `Live session ${session.name}, options`
                        : "Start a live session"
                }
                accessibilityState={{ busy: startingSession }}
                disabled={startingSession}
                onPress={() => void press()}
                className="h-12 w-14 items-center justify-center active:opacity-60"
            >
                {startingSession ? (
                    <ActivityIndicator color={mutedForeground} />
                ) : session ? (
                    <LiveChip />
                ) : (
                    <View className="rounded-full border border-muted-foreground px-2 py-0.5">
                        <Text className="text-[11px] font-bold tracking-wider text-muted-foreground">
                            LIVE
                        </Text>
                    </View>
                )}
            </Pressable>
            {session ? (
                <SessionMenu
                    session={session}
                    open={menuOpen}
                    onClose={() => setMenuOpen(false)}
                />
            ) : null}
        </>
    );
}

/** Settings, listen mode, hand over, leave, and end, as the role allows. */
function SessionMenu({
    session,
    open,
    onClose,
}: {
    session: LiveSession;
    open: boolean;
    onClose: () => void;
}) {
    const openScreen = useOpenScreen();
    const fullPlayback = useMusicAccess().can("fullPlayback");
    const writes = useLiveSessionWrites(session.session_id);
    const isHost = session.my_role === "host";
    const synced = session.my_listen_mode === "synced";
    const [confirm, setConfirm] = useState<"end" | "leave" | null>(null);
    const [busy, setBusy] = useState(false);

    /** Closes the menu, then runs `next`, so popups never stack. */
    const then = (next: () => void) => () => {
        onClose();
        next();
    };

    async function run(action: () => Promise<unknown>, failure: string) {
        try {
            await action();
        } catch (error) {
            Alert.alert(
                "Live session",
                errorType(error) === "Forbidden"
                    ? "Your role does not allow that."
                    : failure,
            );
        }
    }

    async function endOrLeave() {
        setBusy(true);
        try {
            if (confirm === "end") await writes.endSession();
            else await writes.leaveSession();
            setConfirm(null);
        } catch {
            Alert.alert("Live session", "Couldn't do that. Try again.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <ModalPopup visible={open} onClose={onClose} title={session.name}>
                <Text className="px-3 pb-2 text-sm text-muted-foreground">
                    Hosted by {session.host.username}
                </Text>
                {isHost ? (
                    <>
                        <OptionRow
                            label="Session settings"
                            onPress={then(() =>
                                openScreen(
                                    `/live-session/new?edit=${session.session_id}` as Href,
                                ),
                            )}
                        />
                        {session.members.length > 1 ? (
                            <OptionRow
                                label="Leave and hand it over"
                                onPress={then(() => setConfirm("leave"))}
                            />
                        ) : null}
                        <OptionRow
                            label="End session"
                            destructive
                            onPress={then(() => setConfirm("end"))}
                        />
                    </>
                ) : (
                    <>
                        {synced || fullPlayback ? (
                            <OptionRow
                                label={
                                    synced
                                        ? "Stop playing on this phone"
                                        : "Play on this phone too"
                                }
                                onPress={then(
                                    () =>
                                        void run(
                                            () =>
                                                writes.setListenMode(
                                                    synced
                                                        ? "remote"
                                                        : "synced",
                                                ),
                                            "Couldn't switch.",
                                        ),
                                )}
                            />
                        ) : null}
                        <OptionRow
                            label="Leave session"
                            destructive
                            onPress={then(() => setConfirm("leave"))}
                        />
                    </>
                )}
            </ModalPopup>

            <GlassConfirmDialog
                open={confirm !== null}
                title={
                    confirm === "end"
                        ? "End the session for everyone?"
                        : "Leave the session?"
                }
                description={
                    confirm === "end"
                        ? "Everyone in it is let go, and its codes stop working."
                        : isHost
                          ? "Another member becomes the host, and the music moves to their phone."
                          : "Your own queue comes back."
                }
                confirmLabel={confirm === "end" ? "End" : "Leave"}
                pendingLabel={confirm === "end" ? "Ending..." : "Leaving..."}
                pending={busy}
                onOpenChange={(next) => {
                    if (!next) setConfirm(null);
                }}
                onConfirm={() => void endOrLeave()}
            />
        </>
    );
}

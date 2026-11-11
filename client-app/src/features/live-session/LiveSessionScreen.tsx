import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";

import { ErrorNotice } from "@/components/custom/error-notice";
import { InviteCodePopup } from "@/components/custom/invite-code-popup";
import { ModalPopup } from "@/components/custom/modal-popup";
import { SongSearchSheet } from "@/components/custom/song-search-sheet";
import { Button } from "@/components/ui/button";
import { DetailScreen } from "@/components/ui/detail-screen";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassConfirmDialog } from "@/components/ui/glass-confirm-dialog";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { GlassPill } from "@/components/ui/glass-pill";
import {
    SegmentedControl,
    type SegmentOption,
} from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { serverNow } from "@/lib/realtime";
import {
    SESSION_ROLE_LABELS,
    isSessionGone,
    sessionCan,
    useLiveSession,
    useLiveSessionWrites,
    type ListenMode,
    type LiveSession,
    type LiveSessionEntry,
    type LiveSessionMember,
    type SessionRole,
} from "@/lib/routes/live-sessions";
import { useAppTheme } from "@/lib/theme";
import { useMusicAccess } from "@/lib/use-music-access";
import { isUsableArtworkUrl } from "@/lib/utils";

import { formatTrackTime } from "../social/listening-progress";
import { LiveChip } from "../social/LiveChip";
import { MemberRow, RoleMenu } from "../social/MemberRow";
import { expectedPositionMs } from "./session-reconciler";

type Tab = "queue" | "requests" | "people";

const LISTEN_MODES: readonly SegmentOption<ListenMode>[] = [
    { value: "synced", label: "Listen here" },
    { value: "remote", label: "Remote" },
];

const ROLE_CHOICES = (
    ["listener", "suggester", "queue_editor", "controller"] as const
).map((value) => ({ value, label: SESSION_ROLE_LABELS[value] }));

function errorType(error: unknown) {
    return (error as { error_type?: string } | null)?.error_type;
}

/**
 * One live session, for everyone in it. What each person can touch follows
 * their role: listeners watch, suggesters suggest, queue editors edit the
 * queue, controllers also drive playback, and the host does everything.
 * Changes from everyone else arrive through the realtime socket.
 */
export function LiveSessionScreen({ sessionId }: { sessionId: string }) {
    const router = useRouter();
    const {
        liveSession,
        liveSessionLoading,
        liveSessionErr,
        reloadLiveSession,
    } = useLiveSession(sessionId);

    if (liveSessionErr && !liveSession) {
        const type = errorType(liveSessionErr);
        const gone = isSessionGone(liveSessionErr);
        return (
            <DetailScreen presentation="sheet" title="Live session">
                <View className="flex-1 items-center justify-center gap-4 px-6">
                    {gone ? (
                        <>
                            <Text className="text-center text-base font-semibold text-foreground">
                                {type === "SessionEnded"
                                    ? "This session has ended."
                                    : "You're not in this session."}
                            </Text>
                            <GlassButton onPress={() => router.back()}>
                                <Text className="font-semibold text-foreground">
                                    Close
                                </Text>
                            </GlassButton>
                        </>
                    ) : (
                        <ErrorNotice
                            error={liveSessionErr}
                            onRetry={() => void reloadLiveSession()}
                        />
                    )}
                </View>
            </DetailScreen>
        );
    }

    if (!liveSession) {
        return (
            <DetailScreen presentation="sheet" title="Live session">
                <View className="items-center gap-4 px-5 pt-6">
                    <Skeleton className="h-56 w-56 rounded-3xl" />
                    <Skeleton className="h-5 w-40 rounded" />
                    {liveSessionLoading ? null : (
                        <Text className="text-sm text-muted-foreground">
                            Loading...
                        </Text>
                    )}
                </View>
            </DetailScreen>
        );
    }

    return <SessionView session={liveSession} />;
}

function SessionView({ session }: { session: LiveSession }) {
    const router = useRouter();
    const { account } = useAccount();
    const { colors } = useAppTheme();
    const fullPlayback = useMusicAccess().can("fullPlayback");
    const writes = useLiveSessionWrites(session.session_id);
    const role = session.my_role;
    const isHost = role === "host";

    const [tab, setTab] = useState<Tab>("queue");
    const [adding, setAdding] = useState(false);
    const [inviting, setInviting] = useState(false);
    const [optionsOpen, setOptionsOpen] = useState(false);
    const [confirm, setConfirm] = useState<"end" | "leave" | null>(null);
    const [busy, setBusy] = useState(false);
    const [entryMenu, setEntryMenu] = useState<LiveSessionEntry | null>(null);
    const [memberMenu, setMemberMenu] = useState<LiveSessionMember | null>(
        null,
    );
    const [notice, setNotice] = useState<string | null>(null);

    // the entry playing is the projected one, which can be past the anchor's
    const allQueued = [
        ...(session.current ? [session.current] : []),
        ...session.up_next,
    ];
    const playingIndex = Math.max(
        0,
        allQueued.findIndex((e) => e.entry_id === session.playback.entry_id),
    );
    const playing = allQueued[playingIndex] ?? null;
    const upcoming = allQueued.slice(playingIndex + 1);
    const myRequests = session.suggestions.filter(
        (entry) => entry.added_by === account?.id,
    );
    const requests = isHost ? session.suggestions : myRequests;

    async function run(action: () => Promise<unknown>, failure: string) {
        setNotice(null);
        try {
            await action();
        } catch (error) {
            setNotice(
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
            router.back();
        } catch {
            setNotice("Couldn't do that. Try again.");
        } finally {
            setBusy(false);
        }
    }

    const tabs: SegmentOption<Tab>[] = [
        { value: "queue", label: "Queue" },
        ...(sessionCan.suggest(role)
            ? [
                  {
                      value: "requests" as const,
                      label: requests.length
                          ? `Requests ${requests.length}`
                          : "Requests",
                  },
              ]
            : []),
        { value: "people", label: `People ${session.members.length}` },
    ];

    return (
        <DetailScreen
            presentation="sheet"
            title={session.name}
            artworkUrl={playing?.artwork_url}
            headerRight={
                <View className="flex-row items-center gap-2">
                    {isHost ? (
                        <GlassIconButton
                            accessibilityLabel="Invite people"
                            onPress={() => setInviting(true)}
                        >
                            <Ionicons
                                name="share-outline"
                                size={20}
                                color={colors.foreground}
                            />
                        </GlassIconButton>
                    ) : null}
                    <GlassIconButton
                        accessibilityLabel="Session options"
                        onPress={() => setOptionsOpen(true)}
                    >
                        <Ionicons
                            name="ellipsis-horizontal"
                            size={20}
                            color={colors.foreground}
                        />
                    </GlassIconButton>
                </View>
            }
        >
            <ScrollView
                className="flex-1"
                contentContainerClassName="gap-6 px-5 pb-16 pt-2"
            >
                <NowPlayingBlock
                    session={session}
                    entry={playing}
                    canControl={sessionCan.control(role)}
                    onCommand={(body, failure) =>
                        void run(() => writes.sendPlayback(body), failure)
                    }
                />

                {!isHost ? (
                    <View className="gap-1">
                        <SegmentedControl
                            size="sm"
                            options={LISTEN_MODES.map((option) =>
                                option.value === "synced"
                                    ? { ...option, disabled: !fullPlayback }
                                    : option,
                            )}
                            value={session.my_listen_mode}
                            onChange={(mode) =>
                                void run(
                                    () => writes.setListenMode(mode),
                                    "Couldn't switch.",
                                )
                            }
                        />
                        <Text className="text-xs text-muted-foreground">
                            {!fullPlayback
                                ? "Listening here needs an Apple Music subscription."
                                : session.my_listen_mode === "synced"
                                  ? "Plays on this phone, in step with the host."
                                  : "Plays on the host's phone. You see and control it here."}
                        </Text>
                    </View>
                ) : null}

                {notice ? (
                    <Text
                        accessibilityRole="alert"
                        className="text-sm text-destructive"
                    >
                        {notice}
                    </Text>
                ) : null}

                <SegmentedControl
                    size="sm"
                    options={tabs}
                    value={tabs.some((t) => t.value === tab) ? tab : "queue"}
                    onChange={setTab}
                />

                {tab === "queue" ? (
                    <View className="gap-3">
                        {upcoming.length === 0 ? (
                            <Text className="py-4 text-center text-sm text-muted-foreground">
                                Nothing up next.
                            </Text>
                        ) : (
                            <GlassPanel>
                                {upcoming.map((entry, index) => (
                                    <EntryRow
                                        key={entry.entry_id}
                                        entry={entry}
                                        first={index === 0}
                                        onMenu={
                                            sessionCan.editQueue(role)
                                                ? () => setEntryMenu(entry)
                                                : undefined
                                        }
                                    />
                                ))}
                            </GlassPanel>
                        )}
                        {sessionCan.suggest(role) ? (
                            <View className="items-center">
                                <GlassPill
                                    icon="add"
                                    label={
                                        sessionCan.editQueue(role)
                                            ? "Add songs"
                                            : "Suggest a song"
                                    }
                                    onPress={() => setAdding(true)}
                                />
                            </View>
                        ) : null}
                    </View>
                ) : null}

                {tab === "requests" ? (
                    requests.length === 0 ? (
                        <Text className="py-4 text-center text-sm text-muted-foreground">
                            {isHost
                                ? "No suggestions waiting."
                                : "You have no suggestions waiting."}
                        </Text>
                    ) : (
                        <GlassPanel>
                            {requests.map((entry, index) => (
                                <EntryRow
                                    key={entry.entry_id}
                                    entry={entry}
                                    first={index === 0}
                                    trailing={
                                        isHost ? (
                                            <View className="flex-row gap-2">
                                                <Button
                                                    accessibilityLabel={`Reject ${entry.title} from ${entry.added_by_username ?? "someone"}`}
                                                    className="w-9 px-0"
                                                    size="sm"
                                                    variant="outline"
                                                    onPress={() =>
                                                        void run(
                                                            () =>
                                                                writes.reviewSuggestion(
                                                                    entry.entry_id,
                                                                    false,
                                                                ),
                                                            "Couldn't reject it.",
                                                        )
                                                    }
                                                >
                                                    <Ionicons
                                                        name="close"
                                                        size={18}
                                                        color={
                                                            colors.foreground
                                                        }
                                                    />
                                                </Button>
                                                <Button
                                                    accessibilityLabel={`Approve ${entry.title} from ${entry.added_by_username ?? "someone"}`}
                                                    className="w-9 px-0"
                                                    size="sm"
                                                    onPress={() =>
                                                        void run(
                                                            () =>
                                                                writes.reviewSuggestion(
                                                                    entry.entry_id,
                                                                    true,
                                                                ),
                                                            "Couldn't approve it.",
                                                        )
                                                    }
                                                >
                                                    <Ionicons
                                                        name="checkmark"
                                                        size={18}
                                                        color={
                                                            colors.primaryForeground
                                                        }
                                                    />
                                                </Button>
                                            </View>
                                        ) : (
                                            <Pressable
                                                accessibilityRole="button"
                                                accessibilityLabel={`Withdraw ${entry.title}`}
                                                onPress={() =>
                                                    void run(
                                                        () =>
                                                            writes.removeEntry(
                                                                entry.entry_id,
                                                            ),
                                                        "Couldn't withdraw it.",
                                                    )
                                                }
                                                className="active:opacity-60"
                                            >
                                                <Text className="text-xs text-muted-foreground">
                                                    Waiting · Withdraw
                                                </Text>
                                            </Pressable>
                                        )
                                    }
                                />
                            ))}
                        </GlassPanel>
                    )
                ) : null}

                {tab === "people" ? (
                    <GlassPanel>
                        {session.members.map((member, index) => (
                            <View key={member.user_id}>
                                {index > 0 ? (
                                    <View className="ml-[68px] h-px bg-border" />
                                ) : null}
                                <MemberRow
                                    username={member.username}
                                    isYou={member.user_id === account?.id}
                                    roleLabel={
                                        member.is_host
                                            ? "Host"
                                            : SESSION_ROLE_LABELS[member.role]
                                    }
                                    subtitle={
                                        member.listen_mode === "synced"
                                            ? "Listening here"
                                            : "Remote"
                                    }
                                    subtitleIcon={
                                        member.listen_mode === "synced"
                                            ? "volume-high-outline"
                                            : "phone-portrait-outline"
                                    }
                                    manageable={isHost && !member.is_host}
                                    onPress={() =>
                                        isHost && !member.is_host
                                            ? setMemberMenu(member)
                                            : router.push(
                                                  `/social/user/${member.user_id}` as Href,
                                              )
                                    }
                                />
                            </View>
                        ))}
                    </GlassPanel>
                ) : null}
            </ScrollView>

            {adding ? (
                <SongSearchSheet
                    title={
                        sessionCan.editQueue(role)
                            ? "Add songs"
                            : "Suggest a song"
                    }
                    actionLabel={sessionCan.editQueue(role) ? "Add" : "Suggest"}
                    onClose={() => setAdding(false)}
                    onPick={async (song) => {
                        await writes.addSongs({
                            songs: [
                                {
                                    song_id: song.catalogId ?? song.id,
                                    title: song.title,
                                    artist: song.artistName ?? null,
                                    artwork_url: song.artworkUrl ?? null,
                                    duration_ms: song.songDuration
                                        ? Math.round(song.songDuration * 1000)
                                        : null,
                                },
                            ],
                        });
                    }}
                />
            ) : null}

            {inviting ? (
                <InviteCodePopup
                    title={session.name}
                    createInvite={writes.createInvite}
                    onClose={() => setInviting(false)}
                />
            ) : null}

            {entryMenu ? (
                <EntryMenu
                    entry={entryMenu}
                    canJump={sessionCan.control(role)}
                    index={upcoming.findIndex(
                        (e) => e.entry_id === entryMenu.entry_id,
                    )}
                    count={upcoming.length}
                    onClose={() => setEntryMenu(null)}
                    onMove={(position) =>
                        void run(
                            () =>
                                writes.moveEntry(entryMenu.entry_id, position),
                            "Couldn't move it.",
                        )
                    }
                    onRemove={() =>
                        void run(
                            () => writes.removeEntry(entryMenu.entry_id),
                            "Couldn't remove it.",
                        )
                    }
                    onPlayNow={() =>
                        void run(
                            () =>
                                writes.sendPlayback({
                                    kind: "jump",
                                    entry_id: entryMenu.entry_id,
                                }),
                            "Couldn't play it.",
                        )
                    }
                />
            ) : null}

            {memberMenu ? (
                <RoleMenu<SessionRole>
                    username={memberMenu.username}
                    roles={ROLE_CHOICES}
                    current={memberMenu.role}
                    removeLabel="Remove from session"
                    onPick={(newRole) =>
                        void run(
                            () =>
                                writes.setMemberRole({
                                    user_id: memberMenu.user_id,
                                    role: newRole,
                                }),
                            "Couldn't change the role.",
                        )
                    }
                    onViewProfile={() =>
                        router.push(
                            `/social/user/${memberMenu.user_id}` as Href,
                        )
                    }
                    onRemove={() =>
                        void run(
                            () => writes.kickMember(memberMenu.user_id),
                            "Couldn't remove them.",
                        )
                    }
                    onClose={() => setMemberMenu(null)}
                />
            ) : null}

            {optionsOpen ? (
                <ModalPopup
                    visible
                    onClose={() => setOptionsOpen(false)}
                    title={session.name}
                >
                    {isHost ? (
                        <>
                            <OptionRow
                                label="Invite with code"
                                onPress={() => {
                                    setOptionsOpen(false);
                                    setInviting(true);
                                }}
                            />
                            <OptionRow
                                label="Session settings"
                                onPress={() => {
                                    setOptionsOpen(false);
                                    router.push(
                                        `/live-session/new?edit=${session.session_id}` as Href,
                                    );
                                }}
                            />
                            <OptionRow
                                label="End session"
                                destructive
                                onPress={() => {
                                    setOptionsOpen(false);
                                    setConfirm("end");
                                }}
                            />
                        </>
                    ) : (
                        <OptionRow
                            label="Leave session"
                            destructive
                            onPress={() => {
                                setOptionsOpen(false);
                                setConfirm("leave");
                            }}
                        />
                    )}
                </ModalPopup>
            ) : null}

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
                        : "Your own queue comes back."
                }
                confirmLabel={confirm === "end" ? "End" : "Leave"}
                pendingLabel={confirm === "end" ? "Ending..." : "Leaving..."}
                pending={busy}
                onOpenChange={(open) => {
                    if (!open) setConfirm(null);
                }}
                onConfirm={() => void endOrLeave()}
            />
        </DetailScreen>
    );
}

/** Art, title, live progress, and the transport buttons. */
function NowPlayingBlock({
    session,
    entry,
    canControl,
    onCommand,
}: {
    session: LiveSession;
    entry: LiveSessionEntry | null;
    canControl: boolean;
    onCommand: (
        body: Parameters<
            ReturnType<typeof useLiveSessionWrites>["sendPlayback"]
        >[0],
        failure: string,
    ) => void;
}) {
    const { colors } = useAppTheme();
    const [now, setNow] = useState(() => serverNow());
    useEffect(() => {
        const timer = setInterval(() => setNow(serverNow()), 1000);
        return () => clearInterval(timer);
    }, []);

    const position = expectedPositionMs(
        session.playback.position_ms,
        Date.parse(session.playback.as_of),
        session.playback.is_playing,
        now,
    );
    const duration = entry?.duration_ms ?? null;
    const shown = duration ? Math.min(position, duration) : position;
    const fraction = duration ? shown / duration : 0;
    const disabledHint = canControl
        ? undefined
        : "Only controllers can change playback";

    return (
        <View className="items-center gap-3">
            {isUsableArtworkUrl(entry?.artwork_url) ? (
                <Image
                    source={{ uri: entry!.artwork_url! }}
                    className="rounded-3xl bg-muted"
                    style={{ width: 220, height: 220 }}
                />
            ) : (
                <View
                    className="items-center justify-center rounded-3xl bg-muted"
                    style={{ width: 220, height: 220 }}
                >
                    <Ionicons
                        name="musical-notes"
                        size={56}
                        color={colors.mutedForeground}
                    />
                </View>
            )}
            <View className="flex-row items-center gap-2">
                <LiveChip />
                <Text className="text-xs text-muted-foreground">
                    Hosted by {session.host.username}
                </Text>
            </View>
            <View className="items-center">
                <Text
                    className="text-center text-2xl font-bold text-foreground"
                    numberOfLines={2}
                >
                    {entry?.title ?? "Nothing playing"}
                </Text>
                {entry?.artist ? (
                    <Text className="text-base text-muted-foreground">
                        {entry.artist}
                    </Text>
                ) : null}
            </View>
            {entry ? (
                <View className="w-full gap-1">
                    <View
                        accessibilityRole="progressbar"
                        accessibilityValue={{
                            min: 0,
                            max: duration ?? 0,
                            now: shown,
                        }}
                        className="h-1 overflow-hidden rounded-full bg-muted"
                    >
                        <View
                            className="h-full rounded-full bg-brand"
                            style={{ width: `${fraction * 100}%` }}
                        />
                    </View>
                    <View className="flex-row justify-between">
                        <Text className="text-xs text-muted-foreground">
                            {formatTrackTime(shown)}
                        </Text>
                        {duration ? (
                            <Text className="text-xs text-muted-foreground">
                                {formatTrackTime(duration)}
                            </Text>
                        ) : null}
                    </View>
                </View>
            ) : null}
            <View className="flex-row items-center gap-6">
                <GlassIconButton
                    size={48}
                    accessibilityLabel="Restart song"
                    accessibilityHint={disabledHint}
                    disabled={!canControl || !entry}
                    className={canControl ? undefined : "opacity-40"}
                    onPress={() =>
                        onCommand(
                            { kind: "seek", position_ms: 0 },
                            "Couldn't restart.",
                        )
                    }
                >
                    <Ionicons
                        name="play-skip-back"
                        size={22}
                        color={colors.foreground}
                    />
                </GlassIconButton>
                <GlassIconButton
                    size={64}
                    accessibilityLabel={
                        session.playback.is_playing ? "Pause" : "Play"
                    }
                    accessibilityHint={disabledHint}
                    disabled={!canControl || !entry}
                    className={canControl ? undefined : "opacity-40"}
                    onPress={() =>
                        onCommand(
                            {
                                kind: session.playback.is_playing
                                    ? "pause"
                                    : "play",
                            },
                            "Couldn't change playback.",
                        )
                    }
                >
                    <Ionicons
                        name={session.playback.is_playing ? "pause" : "play"}
                        size={30}
                        color={colors.foreground}
                    />
                </GlassIconButton>
                <GlassIconButton
                    size={48}
                    accessibilityLabel="Next"
                    accessibilityHint={disabledHint}
                    disabled={!canControl || !entry}
                    className={canControl ? undefined : "opacity-40"}
                    onPress={() =>
                        onCommand({ kind: "next" }, "Couldn't skip.")
                    }
                >
                    <Ionicons
                        name="play-skip-forward"
                        size={22}
                        color={colors.foreground}
                    />
                </GlassIconButton>
            </View>
        </View>
    );
}

function EntryRow({
    entry,
    first,
    onMenu,
    trailing,
}: {
    entry: LiveSessionEntry;
    first: boolean;
    onMenu?: () => void;
    trailing?: React.ReactNode;
}) {
    const { colors } = useAppTheme();
    const by = entry.added_by_username
        ? ` · added by ${entry.added_by_username}`
        : "";
    return (
        <View>
            {first ? null : <View className="ml-[68px] h-px bg-border" />}
            <View className="flex-row items-center gap-3 px-4 py-3">
                {isUsableArtworkUrl(entry.artwork_url) ? (
                    <Image
                        source={{ uri: entry.artwork_url! }}
                        className="rounded-md bg-muted"
                        style={{ width: 40, height: 40 }}
                    />
                ) : (
                    <View className="h-10 w-10 rounded-md bg-muted" />
                )}
                <View className="min-w-0 flex-1">
                    <Text
                        className="text-sm font-medium text-foreground"
                        numberOfLines={1}
                    >
                        {entry.title}
                    </Text>
                    <Text
                        className="text-xs text-muted-foreground"
                        numberOfLines={1}
                    >
                        {(entry.artist ?? "") + by}
                    </Text>
                </View>
                {trailing ??
                    (onMenu ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Options for ${entry.title}`}
                            hitSlop={8}
                            onPress={onMenu}
                            className="active:opacity-60"
                        >
                            <Ionicons
                                name="ellipsis-horizontal"
                                size={18}
                                color={colors.mutedForeground}
                            />
                        </Pressable>
                    ) : null)}
            </View>
        </View>
    );
}

/** Move, remove, or (for controllers) play an upcoming song now. */
function EntryMenu({
    entry,
    canJump,
    index,
    count,
    onClose,
    onMove,
    onRemove,
    onPlayNow,
}: {
    entry: LiveSessionEntry;
    canJump: boolean;
    index: number;
    count: number;
    onClose: () => void;
    onMove: (position: number) => void;
    onRemove: () => void;
    onPlayNow: () => void;
}) {
    const act = (fn: () => void) => () => {
        onClose();
        fn();
    };
    return (
        <ModalPopup visible onClose={onClose} title={entry.title}>
            {canJump ? (
                <OptionRow label="Play now" onPress={act(onPlayNow)} />
            ) : null}
            {index > 0 ? (
                <OptionRow
                    label="Move up"
                    onPress={act(() => onMove(index - 1))}
                />
            ) : null}
            {index < count - 1 ? (
                <OptionRow
                    label="Move down"
                    onPress={act(() => onMove(index + 1))}
                />
            ) : null}
            <OptionRow label="Remove" destructive onPress={act(onRemove)} />
        </ModalPopup>
    );
}

function OptionRow({
    label,
    destructive = false,
    onPress,
}: {
    label: string;
    destructive?: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            onPress={onPress}
            className="rounded-lg px-3 py-3 active:opacity-60"
        >
            <Text
                className={
                    destructive
                        ? "text-base text-destructive"
                        : "text-base text-foreground"
                }
            >
                {label}
            </Text>
        </Pressable>
    );
}

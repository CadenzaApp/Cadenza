import { useEffect, useMemo, useSyncExternalStore } from "react";
import { mutate } from "swr";

import { useAccount } from "../account";
import { invalidateAPIData, useAPIData, useAPIMutation } from "../api-actions";
import { matchesEndpoint } from "../api-endpoints";
import { serverNow, useRealtimeTopic } from "../realtime";
import {
    holdSessionModes,
    pendingSessionModes,
    subscribeSessionModes,
    withPendingModes,
    type SessionModes,
} from "../session-modes";
import type { CreateInviteBody, Invite } from "./invites";

export type SessionRole =
    | "listener"
    | "suggester"
    | "queue_editor"
    | "controller";
export type ListenMode = "remote" | "synced";

export type LiveSessionMember = {
    user_id: string;
    username: string;
    role: SessionRole;
    listen_mode: ListenMode;
    is_host: boolean;
    joined_at: string;
};

/** One song in the session. Titles are stored, so no Apple lookup needed. */
export type LiveSessionEntry = {
    entry_id: number;
    song_id: string;
    title: string;
    artist: string | null;
    artwork_url: string | null;
    duration_ms: number | null;
    status: "suggested" | "queued" | "played" | "rejected";
    position: number;
    added_by: string | null;
    added_by_username: string | null;
    added_at: string;
};

/** Where playback is, projected to `as_of` on the server's clock. */
export type LiveSessionPlayback = {
    entry_id: number | null;
    position_ms: number;
    is_playing: boolean;
    as_of: string;
    /** Moves only when someone other than the host's phone changes playback. */
    command_seq: number;
    /** The session's own modes, the same for everyone. */
    shuffle: boolean;
    repeat_mode: "off" | "all" | "one";
};

/** Someone who asked to join, waiting on the host. */
export type LiveSessionJoinRequest = {
    user_id: string;
    username: string;
    requested_at: string;
};

/** `GET /live-sessions/{id}`. */
export type LiveSession = {
    session_id: string;
    name: string;
    host: LiveSessionMember;
    default_role: SessionRole;
    allow_join_without_code: boolean;
    /** Opened by listen along, and not made a regular session since. */
    listen_along: boolean;
    /** Someone joining without a code asks first. */
    approve_joins: boolean;
    /** Waiting to be let in. Only the host sees them. */
    join_requests: LiveSessionJoinRequest[];
    version: number;
    /** `host`, or the caller's role. */
    my_role: "host" | SessionRole;
    my_listen_mode: ListenMode;
    members: LiveSessionMember[];
    /** The entry the server's anchor is on. */
    current: LiveSessionEntry | null;
    up_next: LiveSessionEntry[];
    suggestions: LiveSessionEntry[];
    playback: LiveSessionPlayback;
    created_at: string;
};

/** Songs one add can carry. Mirrors `MAX_SONGS_PER_ADD` on the backend. */
export const MAX_SESSION_ADD = 100;
/** Songs a session's queue holds, the current one included. Mirrors `MAX_QUEUE`. */
export const MAX_SESSION_QUEUE = 500;

export type SessionVersion = {
    version: number | null;
    ended: boolean;
    /** The new playback, when the write moved only that. */
    playback?: LiveSessionPlayback;
};

/** A song to add, as the client knows it. */
export type QueueSongBody = {
    song_id: string;
    title: string;
    artist: string | null;
    artwork_url: string | null;
    duration_ms: number | null;
};

export type PlaybackBody =
    | { kind: "play" }
    | { kind: "pause" }
    | { kind: "seek"; position_ms: number }
    | { kind: "next" }
    /** Restarts the song, or near its start goes to the last one played. */
    | { kind: "previous" }
    | { kind: "jump"; entry_id: number }
    | { kind: "shuffle"; on: boolean }
    | { kind: "repeat"; mode: LiveSessionPlayback["repeat_mode"] }
    | {
          kind: "report";
          entry_id: number | null;
          position_ms: number;
          is_playing: boolean;
          /** The last command this phone followed; older reports are ignored. */
          command_seq: number | null;
      }
    | { kind: "advance"; from_entry_id: number };

type Role = LiveSession["my_role"];
const RANK: Record<Role, number> = {
    listener: 0,
    suggester: 1,
    queue_editor: 2,
    controller: 3,
    host: 4,
};

/** What a role may do. Mirrors `services/live_sessions.rs` on the backend. */
export const sessionCan = {
    suggest: (role: Role) => RANK[role] >= RANK.suggester,
    editQueue: (role: Role) => RANK[role] >= RANK.queue_editor,
    control: (role: Role) => RANK[role] >= RANK.controller,
    manage: (role: Role) => role === "host",
};

/**
 * Whether a session shows as live: any regular one, and a listen along one
 * once someone joins. A listen along session nobody joined runs quietly, so
 * just playing a song does not put the player in live mode.
 */
export function showsAsLive(
    session: Pick<LiveSession, "listen_along" | "members">,
) {
    return !session.listen_along || session.members.length > 1;
}

export const SESSION_ROLE_LABELS: Record<SessionRole, string> = {
    listener: "Listener",
    suggester: "Suggester",
    queue_editor: "Queue editor",
    controller: "Controller",
};

/**
 * The open session the caller hosts or is in, or null. Refetches when the
 * caller's own topic says their session changed, like a host letting them in.
 */
export function useMyLiveSession() {
    const { account } = useAccount();
    const x = useAPIData<{ session_id: string | null }>(
        "/live-sessions/current",
    );
    useRealtimeTopic(
        account ? { kind: "user", id: account.id } : null,
        (event) => {
            if (event.kind === "live_session") void x.mutate();
        },
    );
    return {
        mySessionId: x.data?.session_id ?? null,
        mySessionLoading: x.isLoading,
        reloadMySession: x.mutate,
    };
}

/** Changes the cached snapshot of session `id` in place, without a fetch. */
async function patchSession(
    id: string,
    update: (session: LiveSession) => LiveSession | null,
) {
    let missed = false;
    await mutate(
        (key) => matchesEndpoint(key, { path: `/live-sessions/${id}` }),
        (current?: LiveSession) => {
            if (!current) return current;
            const next = update(current);
            if (next === null) missed = true;
            return next ?? current;
        },
        { revalidate: false },
    );
    if (missed) await invalidateAPIData([{ path: `/live-sessions/${id}` }]);
}

/**
 * Applies a playback only change at `version` straight to the cached
 * snapshot, from the `playback` event or the write's own response, so a pause
 * or seek lands without a refetch. A snapshot more than one version behind
 * has missed something else, so it refetches instead.
 */
function applyPlaybackChange(
    id: string,
    version: number,
    playback: LiveSessionPlayback,
) {
    return patchSession(id, (session) => {
        if (session.version >= version) return session;
        if (session.version !== version - 1) return null;
        return { ...session, version, playback };
    });
}

/**
 * What a play, pause, or seek will do, applied to the cached snapshot before
 * the server answers, so the caller's own screen moves at once. The version
 * stays, so the server's change still applies over it.
 */
function optimisticPlayback(
    playback: LiveSessionPlayback,
    body: PlaybackBody,
): LiveSessionPlayback | null {
    const now = serverNow();
    const position =
        playback.position_ms +
        (playback.is_playing
            ? Math.max(0, now - Date.parse(playback.as_of))
            : 0);
    const at = new Date(now).toISOString();
    switch (body.kind) {
        case "play":
        case "pause":
            return {
                ...playback,
                is_playing: body.kind === "play" && playback.entry_id !== null,
                position_ms: position,
                as_of: at,
            };
        case "seek":
            return { ...playback, position_ms: body.position_ms, as_of: at };
        default:
            return null;
    }
}

/** The shuffle or repeat a command sets, or null for any other command. */
function modesOf(body: PlaybackBody): Partial<SessionModes> | null {
    switch (body.kind) {
        case "shuffle":
            return { shuffle: body.on };
        case "repeat":
            return { repeat_mode: body.mode };
        default:
            return null;
    }
}

/** Whether a session read failed because the session is over or gone. */
export function isSessionGone(error: unknown) {
    const type = (error as { error_type?: string } | null)?.error_type;
    return type === "SessionEnded" || type === "NotFound";
}

/**
 * One session's snapshot, refetched whenever it changes through the realtime
 * socket. A 410 `SessionEnded` comes back as the error, and then the snapshot
 * is undefined: SWR would keep the last one, and a member would go on seeing
 * the session as live. An end also refetches `/live-sessions/current`, since
 * only the host's own write invalidates it. A shuffle or repeat the caller
 * just set shows over the snapshot until the server answers.
 */
export function useLiveSession(id: string | null) {
    const x = useAPIData<LiveSession>(`/live-sessions/${id}`, undefined, {
        enabled: id !== null,
    });
    useRealtimeTopic(id ? { kind: "live_session", id } : null, (event) => {
        if (event.kind === "ended") {
            void invalidateAPIData([{ path: "/live-sessions/current" }]);
        }
        if (event.kind === "playback" && event.data) {
            void applyPlaybackChange(
                id!,
                event.version,
                event.data as LiveSessionPlayback,
            );
            return;
        }
        if (event.kind === "resync" || event.version !== x.data?.version) {
            void x.mutate();
        }
    });
    const gone = isSessionGone(x.error);
    useEffect(() => {
        if (gone) void invalidateAPIData([{ path: "/live-sessions/current" }]);
    }, [gone]);
    const pending = useSyncExternalStore(subscribeSessionModes, () =>
        id ? pendingSessionModes(id) : undefined,
    );
    const shown = useMemo(
        () =>
            x.data && pending
                ? {
                      ...x.data,
                      playback: withPendingModes(x.data.playback, pending),
                  }
                : x.data,
        [x.data, pending],
    );
    return {
        liveSession: gone ? undefined : shown,
        liveSessionLoading: x.isLoading,
        liveSessionErr: x.error,
        reloadLiveSession: x.mutate,
    };
}

export function useStartLiveSession() {
    const x = useAPIMutation<
        {
            name: string;
            default_role?: SessionRole;
            allow_join_without_code?: boolean;
            /** Opened by listen along; joins check its own audience. */
            listen_along?: boolean;
            /** Default true: someone joining without a code asks first. */
            approve_joins?: boolean;
        },
        { session_id: string }
    >("POST", "/live-sessions", [{ path: "/live-sessions/current" }], {
        // the player sheet opened next stays open only once this is known
        invalidation: "await",
    });
    return {
        startLiveSession: x.trigger,
        startLiveSessionLoading: x.isMutating,
        startLiveSessionErr: x.error,
    };
}

/**
 * Adds songs to a session named at call time, for seeding a new session with
 * the host's own queue right after it starts.
 */
export function useSeedSessionQueue() {
    const x = useAPIMutation<
        {
            session_id: string;
            songs: QueueSongBody[];
            /** Where the host's phone is in the first song, when it is current. */
            start_position_ms?: number;
            start_playing?: boolean;
        },
        SessionVersion
    >("POST", ({ session_id }) => `/live-sessions/${session_id}/queue`, [], {
        invalidation: "none",
    });
    return { seedSessionQueue: x.trigger };
}

/** Joining from Listening now, without a code. */
/**
 * Lets someone who asked into the caller's session, or turns them away, from
 * outside the session, like the Notifications screen.
 */
export function useAnswerJoinRequest() {
    const x = useAPIMutation<
        { session_id: string; user_id: string; accept: boolean },
        SessionVersion
    >(
        "POST",
        ({ session_id, user_id }) =>
            `/live-sessions/${session_id}/join-requests/${user_id}`,
        [],
        { invalidation: "none" },
    );
    return {
        answerJoinRequest: x.trigger,
        answerJoinRequestLoading: x.isMutating,
    };
}

/** `joined`, or `asked` when the host has to let the caller in. */
export type JoinResult = { version: number; status: "joined" | "asked" };

/**
 * Joins a friend from Listening now: the session they are in, or with none, a
 * listen along session the backend makes for them right then.
 */
export function useJoinListening() {
    const x = useAPIMutation<
        { user_id: string },
        JoinResult & { session_id: string }
    >(
        "POST",
        ({ user_id }) => `/live-sessions/listen-along/${user_id}`,
        [{ path: "/live-sessions/current" }],
        { invalidation: "await" },
    );
    return {
        joinListening: x.trigger,
        joinListeningLoading: x.isMutating,
    };
}

/**
 * Every write to one session. Each refetches the snapshot after; the socket
 * tells everyone else. Playback is quicker: play, pause, seek, shuffle, and
 * repeat show at once, and a change that moved only playback is applied from
 * the response. A failed one goes back.
 */
export function useLiveSessionWrites(id: string) {
    const base = `/live-sessions/${id}`;
    const touched = [{ path: base }];
    const touchedAndCurrent = [...touched, { path: "/live-sessions/current" }];

    const playback = useAPIMutation<PlaybackBody, SessionVersion>(
        "POST",
        `${base}/playback`,
        touched,
        { invalidation: "none" },
    );

    async function sendPlayback(body: PlaybackBody) {
        const modes = modesOf(body);
        // held until the cache has the server's word, so they never flick back
        const release = modes ? holdSessionModes(id, modes) : () => {};
        await patchSession(id, (session) => {
            const next = optimisticPlayback(session.playback, body);
            return next ? { ...session, playback: next } : session;
        });
        try {
            const result = await playback.trigger(body);
            if (result?.playback && result.version !== null) {
                await applyPlaybackChange(id, result.version, result.playback);
                release();
            } else if (result?.version !== null) {
                void invalidateAPIData(touched).finally(release);
            } else {
                release();
            }
            return result;
        } catch (error) {
            // undo the optimistic change
            release();
            void invalidateAPIData(touched);
            throw error;
        }
    }
    const addSongs = useAPIMutation<
        { songs: QueueSongBody[]; position?: number; play_now?: boolean },
        SessionVersion
    >("POST", `${base}/queue`, touched);
    const entryAction = useAPIMutation<
        | { entry_id: number; action: "move"; position: number }
        | { entry_id: number; action: "approve" | "reject" },
        SessionVersion
    >("PATCH", ({ entry_id }) => `${base}/queue/${entry_id}`, touched);
    const removeEntry = useAPIMutation<{ entry_id: number }, SessionVersion>(
        "DELETE",
        ({ entry_id }) => `${base}/queue/${entry_id}`,
        touched,
    );
    const update = useAPIMutation<
        {
            name?: string;
            default_role?: SessionRole;
            allow_join_without_code?: boolean;
            /** False makes a listen along session a regular one. */
            listen_along?: boolean;
            approve_joins?: boolean;
        },
        SessionVersion
    >("PATCH", base, touched);
    const setRole = useAPIMutation<
        { user_id: string; role: SessionRole },
        SessionVersion
    >("PATCH", ({ user_id }) => `${base}/members/${user_id}`, touched);
    const answerJoin = useAPIMutation<
        { user_id: string; accept: boolean },
        SessionVersion
    >("POST", ({ user_id }) => `${base}/join-requests/${user_id}`, touched);
    const kick = useAPIMutation<{ user_id: string }, SessionVersion>(
        "DELETE",
        ({ user_id }) => `${base}/members/${user_id}`,
        touched,
    );
    const listenMode = useAPIMutation<
        { listen_mode: ListenMode },
        SessionVersion
    >("PATCH", `${base}/me`, touched);
    const leave = useAPIMutation<void, SessionVersion>(
        "POST",
        `${base}/leave`,
        touchedAndCurrent,
    );
    const end = useAPIMutation<void, SessionVersion>(
        "DELETE",
        base,
        touchedAndCurrent,
    );
    const invite = useAPIMutation<CreateInviteBody, Invite>(
        "POST",
        `${base}/invites`,
        [],
        { invalidation: "none" },
    );

    return {
        sendPlayback,
        addSongs: addSongs.trigger,
        moveEntry: (entry_id: number, position: number) =>
            entryAction.trigger({ entry_id, action: "move", position }),
        reviewSuggestion: (entry_id: number, approve: boolean) =>
            entryAction.trigger({
                entry_id,
                action: approve ? "approve" : "reject",
            }),
        removeEntry: (entry_id: number) => removeEntry.trigger({ entry_id }),
        updateSession: update.trigger,
        setMemberRole: setRole.trigger,
        kickMember: (user_id: string) => kick.trigger({ user_id }),
        answerJoinRequest: (user_id: string, accept: boolean) =>
            answerJoin.trigger({ user_id, accept }),
        setListenMode: (listen_mode: ListenMode) =>
            listenMode.trigger({ listen_mode }),
        leaveSession: () => leave.trigger(),
        endSession: () => end.trigger(),
        createInvite: invite.trigger,
    };
}

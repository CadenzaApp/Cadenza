import { useEffect } from "react";

import { invalidateAPIData, useAPIData, useAPIMutation } from "../api-actions";
import { useRealtimeTopic } from "../realtime";
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
};

/** `GET /live-sessions/{id}`. */
export type LiveSession = {
    session_id: string;
    name: string;
    host: LiveSessionMember;
    default_role: SessionRole;
    allow_join_without_code: boolean;
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

export type SessionVersion = { version: number | null; ended: boolean };

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
    | { kind: "jump"; entry_id: number }
    | {
          kind: "report";
          entry_id: number | null;
          position_ms: number;
          is_playing: boolean;
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

export const SESSION_ROLE_LABELS: Record<SessionRole, string> = {
    listener: "Listener",
    suggester: "Suggester",
    queue_editor: "Queue editor",
    controller: "Controller",
};

/** The open session the caller hosts or is in, or null. */
export function useMyLiveSession() {
    const x = useAPIData<{ session_id: string | null }>(
        "/live-sessions/current",
    );
    return {
        mySessionId: x.data?.session_id ?? null,
        mySessionLoading: x.isLoading,
        reloadMySession: x.mutate,
    };
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
 * only the host's own write invalidates it.
 */
export function useLiveSession(id: string | null) {
    const x = useAPIData<LiveSession>(`/live-sessions/${id}`, undefined, {
        enabled: id !== null,
    });
    useRealtimeTopic(id ? { kind: "live_session", id } : null, (event) => {
        if (event.kind === "ended") {
            void invalidateAPIData([{ path: "/live-sessions/current" }]);
        }
        if (event.kind === "resync" || event.version !== x.data?.version) {
            void x.mutate();
        }
    });
    const gone = isSessionGone(x.error);
    useEffect(() => {
        if (gone) void invalidateAPIData([{ path: "/live-sessions/current" }]);
    }, [gone]);
    return {
        liveSession: gone ? undefined : x.data,
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
        },
        { session_id: string }
    >("POST", "/live-sessions", [{ path: "/live-sessions/current" }]);
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
export function useJoinLiveSession() {
    const x = useAPIMutation<{ session_id: string }, SessionVersion>(
        "POST",
        ({ session_id }) => `/live-sessions/${session_id}/join`,
        [{ path: "/live-sessions/current" }],
    );
    return {
        joinLiveSession: x.trigger,
        joinLiveSessionLoading: x.isMutating,
    };
}

/**
 * Every write to one session. Each refetches the snapshot after; the socket
 * tells everyone else.
 */
export function useLiveSessionWrites(id: string) {
    const base = `/live-sessions/${id}`;
    const touched = [{ path: base }];
    const touchedAndCurrent = [...touched, { path: "/live-sessions/current" }];

    const playback = useAPIMutation<PlaybackBody, SessionVersion>(
        "POST",
        `${base}/playback`,
        touched,
    );
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
        },
        SessionVersion
    >("PATCH", base, touched);
    const setRole = useAPIMutation<
        { user_id: string; role: SessionRole },
        SessionVersion
    >("PATCH", ({ user_id }) => `${base}/members/${user_id}`, touched);
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
        sendPlayback: playback.trigger,
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
        setListenMode: (listen_mode: ListenMode) =>
            listenMode.trigger({ listen_mode }),
        leaveSession: () => leave.trigger(),
        endSession: () => end.trigger(),
        createInvite: invite.trigger,
    };
}

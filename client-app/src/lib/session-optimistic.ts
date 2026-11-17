import type {
    LiveSession,
    LiveSessionEntry,
    LiveSessionPlayback,
    PlaybackBody,
    QueueSongBody,
} from "./routes/live-sessions";
import { playbackPositionMs } from "./session-playback.ts";

/**
 * What each live session write will do, applied to the cached snapshot before
 * the server answers, so the screen and the phone's queue move as fast as
 * they do outside a session. Each mirrors its handler in
 * `backend-api/src/db/live_sessions.rs`. The version stays, so the server's
 * snapshot still lands over the guess; a failed write refetches it.
 *
 * Songs added here get negative entry ids until the server's snapshot gives
 * them real ones. Anything the server alone knows, like the last song played
 * or a shuffle's new order, returns null and waits for it.
 */

let lastFakeId = 0;

/** Whether an entry is a guess still waiting on its real id. */
export function isPendingEntry(entry: Pick<LiveSessionEntry, "entry_id">) {
    return entry.entry_id < 0;
}

/** Drops an upcoming song or a suggestion. */
export function removeEntry(
    session: LiveSession,
    entryId: number,
): LiveSession {
    const keep = (entry: LiveSessionEntry) => entry.entry_id !== entryId;
    return {
        ...session,
        up_next: session.up_next.filter(keep),
        suggestions: session.suggestions.filter(keep),
    };
}

/** Moves an upcoming song to `position` among the upcoming, clamped. */
export function moveEntry(
    session: LiveSession,
    entryId: number,
    position: number,
): LiveSession {
    const from = session.up_next.findIndex(
        (entry) => entry.entry_id === entryId,
    );
    if (from < 0) return session;
    const upNext = [...session.up_next];
    const [moved] = upNext.splice(from, 1);
    upNext.splice(Math.min(Math.max(0, position), upNext.length), 0, moved!);
    return { ...session, up_next: upNext };
}

/** Approve puts a suggestion at the end of the queue; reject drops it. */
export function reviewSuggestion(
    session: LiveSession,
    entryId: number,
    approve: boolean,
): LiveSession {
    const entry = session.suggestions.find((e) => e.entry_id === entryId);
    if (!entry) return session;
    const suggestions = session.suggestions.filter((e) => e !== entry);
    if (!approve) return { ...session, suggestions };
    return {
        ...session,
        suggestions,
        up_next: [...session.up_next, { ...entry, status: "queued" }],
    };
}

/**
 * Adds songs the way the server will: a suggestion when the caller cannot
 * edit the queue, otherwise at `position` among the upcoming (missing is the
 * end). `playNow` puts them next and plays the first. An empty session
 * starts on its first song.
 */
export function addSongs(
    session: LiveSession,
    songs: readonly QueueSongBody[],
    options: {
        position?: number;
        playNow?: boolean;
        startPositionMs?: number;
        startPlaying?: boolean;
    },
    nowMs: number,
): LiveSession {
    const queued = session.can.edit_queue;
    const added = songs.map(
        (song): LiveSessionEntry => ({
            ...song,
            entry_id: (lastFakeId -= 1),
            status: queued ? "queued" : "suggested",
            position: 0,
            added_by: null,
            added_by_username: null,
            added_at: new Date(nowMs).toISOString(),
        }),
    );
    if (added.length === 0) return session;
    if (!queued) {
        return { ...session, suggestions: [...session.suggestions, ...added] };
    }

    const at = options.playNow
        ? 0
        : Math.min(
              Math.max(0, options.position ?? session.up_next.length),
              session.up_next.length,
          );
    const upNext = [
        ...session.up_next.slice(0, at),
        ...added,
        ...session.up_next.slice(at),
    ];
    if (options.playNow) {
        return startOn(session, upNext, true, 0, nowMs, true);
    }
    if (!session.current) {
        return startOn(
            session,
            upNext,
            options.startPlaying ?? true,
            options.startPositionMs ?? 0,
            nowMs,
            options.startPositionMs === undefined,
        );
    }
    return { ...session, up_next: upNext };
}

/**
 * A playback command, or null when only the server can tell what it does.
 * Every command moves `command_seq`, as the server will, so the host's phone
 * follows the guess right away.
 */
export function playbackCommand(
    session: LiveSession,
    body: PlaybackBody,
    nowMs: number,
): LiveSession | null {
    const { playback } = session;
    const position = playbackPositionMs(playback, nowMs);
    const anchor = (changes: Partial<LiveSessionPlayback>): LiveSession => ({
        ...session,
        playback: {
            ...playback,
            position_ms: position,
            as_of: new Date(nowMs).toISOString(),
            command_seq: playback.command_seq + 1,
            ...changes,
        },
    });
    switch (body.kind) {
        case "play":
        case "pause":
            return anchor({
                is_playing: body.kind === "play" && playback.entry_id !== null,
            });
        case "seek":
            return anchor({ position_ms: body.position_ms });
        case "previous":
            // back a song needs the last one played, which only the server
            // has. a restart is sent as a seek to 0, which is guessed above
            return null;
        case "next": {
            if (session.up_next.length === 0) return null;
            return startOn(
                session,
                session.up_next,
                playback.is_playing,
                0,
                nowMs,
                true,
            );
        }
        case "jump": {
            const at = session.up_next.findIndex(
                (entry) => entry.entry_id === body.entry_id,
            );
            if (at < 0) return null;
            return startOn(
                session,
                session.up_next.slice(at),
                true,
                0,
                nowMs,
                true,
            );
        }
        default:
            return null;
    }
}

/**
 * The first of `upNext` becomes current and the rest stay upcoming; the old
 * current counts as played and leaves.
 */
function startOn(
    session: LiveSession,
    upNext: readonly LiveSessionEntry[],
    isPlaying: boolean,
    positionMs: number,
    nowMs: number,
    command: boolean,
): LiveSession {
    const [current, ...rest] = upNext;
    if (!current) return session;
    const { playback } = session;
    return {
        ...session,
        current,
        up_next: rest,
        playback: {
            ...playback,
            entry_id: current.entry_id,
            is_playing: isPlaying,
            position_ms: positionMs,
            as_of: new Date(nowMs).toISOString(),
            command_seq: playback.command_seq + (command ? 1 : 0),
        },
    };
}

import type { MusicItem } from "@apple-musickit";

import { shareableSongId } from "../../lib/now-playing-change.ts";
import type {
    LiveSession,
    LiveSessionEntry,
    QueueSongBody,
} from "@/lib/routes/live-sessions";

/** A track as a session song, or null for a library only song. */
export function trackToSessionSong(track: MusicItem): QueueSongBody | null {
    const songId = shareableSongId(track);
    if (!songId) return null;
    return {
        song_id: songId,
        title: track.title,
        artist: track.artistName ?? null,
        artwork_url: track.artworkUrl ?? null,
        duration_ms: track.songDuration
            ? Math.round(track.songDuration * 1000)
            : null,
    };
}

/** The tracks that can go in a session, in order. */
export function sessionSongs(tracks: readonly MusicItem[]): QueueSongBody[] {
    return tracks.flatMap((track) => {
        const song = trackToSessionSong(track);
        return song ? [song] : [];
    });
}

/**
 * The upcoming session entry at a whole-queue position of the local player,
 * whose queue follows the session from `queueIndex` on. Null when that
 * position is the playing song, already played, or past the session's queue.
 */
export function upcomingEntryAt(
    session: Pick<LiveSession, "up_next">,
    queueIndex: number,
    index: number,
): { entry: LiveSessionEntry; position: number } | null {
    const position = index - (queueIndex + 1);
    const entry = session.up_next[position];
    return entry ? { entry, position } : null;
}

/** Where a whole-queue move lands among the upcoming songs. */
export function upcomingPosition(queueIndex: number, index: number): number {
    return Math.max(0, index - (queueIndex + 1));
}

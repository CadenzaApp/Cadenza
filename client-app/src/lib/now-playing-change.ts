/**
 * Decides when the player's state is worth sending to
 * `PUT /listening/now-playing`. The provider samples every 750 ms, and most
 * samples only move the position forward, which the backend projects on its
 * own. Only a new song, a play or pause, a seek, or a heartbeat is sent.
 *
 * Pure apart from a type import, so `now-playing-change.test.ts` runs it under
 * `node --test`.
 */

import type { MusicItem } from "@apple-musickit";

/** A heartbeat while playing, so a phone that keeps playing stays shown. */
export const HEARTBEAT_MS = 60_000;

/** A jump this far off the expected position is a seek. */
export const SEEK_TOLERANCE_MS = 3_000;

/** One player sample, as the reporter sees it. */
export type NowPlayingSample = {
    /** Catalog id, or null when nothing shareable is playing. */
    songId: string | null;
    /** Ids of the up next songs, joined, so a queue edit is a change. */
    upNextKey: string;
    isPlaying: boolean;
    positionMs: number;
    /** Local clock, ms. */
    at: number;
};

/** What to do with a sample, given the last one sent. */
export type NowPlayingAction = "put" | "clear" | null;

/**
 * The catalog id other accounts can play, or null. A library id (`i.`) means
 * nothing on someone else's account, so a library only song is not shared.
 */
export function shareableSongId(track: MusicItem | null): string | null {
    if (!track) return null;
    const id =
        track.catalogId ?? (track.source === "catalog" ? track.id : null);
    return id && !id.startsWith("i.") ? id : null;
}

/** How many up next songs are sent. The backend keeps the same number. */
export const UP_NEXT_COUNT = 2;

/** One up next song as `PUT /listening/now-playing` takes it. */
export type UpNextSong = {
    /** Null for a library only song. */
    song_id: string | null;
    title: string;
    artist: string | null;
    artwork_url: string | null;
};

/**
 * The songs after `index` in `queue`. Empty while the native player shuffles,
 * since then the queue's order is not the order it plays in.
 */
export function upNextSongs(
    queue: readonly MusicItem[],
    index: number,
    shuffled: boolean,
): UpNextSong[] {
    if (shuffled || index < 0) return [];
    return queue.slice(index + 1, index + 1 + UP_NEXT_COUNT).map((track) => ({
        song_id: shareableSongId(track),
        title: track.title,
        artist: track.artistName ?? null,
        artwork_url: track.artworkUrl ?? null,
    }));
}

/** What `NowPlayingSample.upNextKey` holds for these songs. */
export function upNextKey(songs: readonly UpNextSong[]): string {
    return songs.map((song) => song.song_id ?? song.title).join("|");
}

export function nowPlayingAction(
    lastSent: NowPlayingSample | null,
    sample: NowPlayingSample,
): NowPlayingAction {
    if (sample.songId === null) {
        return lastSent?.songId != null ? "clear" : null;
    }
    if (!lastSent || lastSent.songId !== sample.songId) return "put";
    if (lastSent.isPlaying !== sample.isPlaying) return "put";
    if (lastSent.upNextKey !== sample.upNextKey) return "put";

    const elapsed = sample.at - lastSent.at;
    const expected = lastSent.positionMs + (lastSent.isPlaying ? elapsed : 0);
    if (Math.abs(sample.positionMs - expected) > SEEK_TOLERANCE_MS) {
        return "put";
    }
    if (sample.isPlaying && elapsed >= HEARTBEAT_MS) return "put";
    return null;
}

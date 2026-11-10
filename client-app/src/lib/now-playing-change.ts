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

export function nowPlayingAction(
    lastSent: NowPlayingSample | null,
    sample: NowPlayingSample,
): NowPlayingAction {
    if (sample.songId === null) {
        return lastSent?.songId != null ? "clear" : null;
    }
    if (!lastSent || lastSent.songId !== sample.songId) return "put";
    if (lastSent.isPlaying !== sample.isPlaying) return "put";

    const elapsed = sample.at - lastSent.at;
    const expected = lastSent.positionMs + (lastSent.isPlaying ? elapsed : 0);
    if (Math.abs(sample.positionMs - expected) > SEEK_TOLERANCE_MS) {
        return "put";
    }
    if (sample.isPlaying && elapsed >= HEARTBEAT_MS) return "put";
    return null;
}

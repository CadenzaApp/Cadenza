import type { MusicItem } from "@apple-musickit";
import { useMemo } from "react";

import { useSongInfo } from "@/lib/musickit-hooks";
import type { SharedPlaylistEntry } from "@/lib/routes/shared-playlists";

/** A row id that names its entry, since one song can be in twice. */
export function entryTrackId(entryId: number) {
    return `entry:${entryId}`;
}

export function entryIdOf(track: MusicItem): number | null {
    const match = /^entry:(\d+)$/.exec(track.id);
    return match ? Number(match[1]) : null;
}

/**
 * A shared playlist's entries as playable tracks, in order, titles and art
 * from Apple Music. Each track's id is its entry's, through `entryTrackId`.
 * An entry Apple Music cannot describe is left out.
 */
export function usePlaylistTracks(entries: readonly SharedPlaylistEntry[]) {
    const songIds = useMemo(() => entries.map((e) => e.song_id), [entries]);
    const { songInfo, songInfoLoading } = useSongInfo(songIds);
    const tracks = useMemo(() => {
        const byId = new Map<string, MusicItem>();
        for (const song of songInfo) {
            byId.set(song.id, song);
            if (song.catalogId) byId.set(song.catalogId, song);
        }
        return entries.flatMap((entry) => {
            const song = byId.get(entry.song_id);
            if (!song) return [];
            return [
                {
                    ...song,
                    id: entryTrackId(entry.entry_id),
                    catalogId: entry.song_id,
                    playbackId: song.playbackId ?? entry.song_id,
                },
            ];
        });
    }, [entries, songInfo]);
    return { songIds, tracks, tracksLoading: songInfoLoading };
}

import type { MusicItem } from "@apple-musickit";
import { useMemo } from "react";

import { useSongInfo } from "@/lib/musickit-hooks";
import type { SharedPlaylistEntry } from "@/lib/routes/shared-playlists";

/**
 * A shared playlist's songs as playable tracks, in order, titles and art from
 * Apple Music. The track id is the catalog song id. A song Apple Music cannot
 * describe is left out.
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
                    id: entry.song_id,
                    catalogId: entry.song_id,
                    playbackId: song.playbackId ?? entry.song_id,
                },
            ];
        });
    }, [entries, songInfo]);
    return { songIds, tracks, tracksLoading: songInfoLoading };
}

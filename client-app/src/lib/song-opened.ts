import { useEffect } from "react";
import type { MusicItem } from "@apple-musickit";

import { useReportSongOpened } from "./routes/songs";

/**
 * Reports each song the player opens to the backend, once per song, so its
 * Apple Music metadata is stored for the "Song info" query fields along with
 * the rest of its album. Called once, from `PlaybackProvider`.
 *
 * Keyed on the catalog id, like tags, so a library copy and a catalog copy of a
 * song are the same song. A failure is only logged: the song stays out of
 * metadata queries until it is opened or listed again.
 */
export function useReportOpenedSongs(activeTrack: MusicItem | null) {
    const { reportSongOpened } = useReportSongOpened();
    const songId = activeTrack
        ? (activeTrack.catalogId ?? activeTrack.id)
        : null;

    useEffect(() => {
        if (!songId) return;

        const report = async () => {
            try {
                await reportSongOpened({ song_id: songId });
            } catch (error) {
                console.warn("Could not report an opened song:", error);
            }
        };
        void report();
    }, [songId, reportSongOpened]);
}

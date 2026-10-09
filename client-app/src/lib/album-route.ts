import type { MusicItem } from "@apple-musickit";
import { useMemo } from "react";

import { albumRouteForTrack, isLibraryId } from "./music-routes";
import { useSongInfo } from "./musickit-hooks";

/**
 * The full Apple Music album a track is on, as a route.
 *
 * A library song's `albumID` is the library album, which holds only the songs
 * the user added. So for one, the catalog song is looked up and its album used
 * instead. A song with no catalog entry (an upload) keeps its library album.
 */
export function useAlbumRouteForTrack(track: MusicItem | null | undefined) {
    const ownAlbumId = track?.albumID;
    const catalogSongId =
        track && (!ownAlbumId || isLibraryId(ownAlbumId))
            ? track.catalogId
            : undefined;
    const songIds = useMemo(
        () => (catalogSongId ? [catalogSongId] : null),
        [catalogSongId],
    );
    const { songInfo, songInfoLoading } = useSongInfo(songIds);
    const catalogAlbumId = catalogSongId ? songInfo[0]?.albumID : undefined;

    const albumRoute = useMemo(
        () =>
            track
                ? albumRouteForTrack(track, catalogAlbumId ?? ownAlbumId)
                : null,
        [catalogAlbumId, ownAlbumId, track],
    );
    return {
        albumRoute,
        albumRouteLoading: catalogSongId != null && songInfoLoading,
    };
}

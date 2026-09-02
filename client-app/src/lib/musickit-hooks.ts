import {
    CatalogSearchType,
    MusicKit,
    MusicKitOptions,
    SearchResult,
    SongFavoriteStatus,
} from "@apple-musickit";
import { useState } from "react";
import useSWR from "swr";

/** Returns cached Apple Music metadata for the supplied song IDs. */
export function useSongInfo(songIds?: readonly string[] | null) {
    const key = songIds?.length
        ? (["MusicKit.getSongInfo", [...songIds]] as const)
        : null;
    const x = useSWR(key, ([, ids]) => MusicKit.getSongInfo([...ids]));
    return {
        songInfo: x.data ?? [],
        songInfoLoading: x.isLoading,
        songInfoErr: x.error,
    };
}

/** Provides an explicitly triggered, query-keyed Apple Music catalog search. */
export function useCatalogSearch() {
    const [request, setRequest] = useState<{
        query: string;
        types: CatalogSearchType[];
    } | null>(null);
    const key = request
        ? (["MusicKit.catalogSearch", request.query, request.types] as const)
        : null;
    const x = useSWR<SearchResult>(key, () =>
        MusicKit.catalogSearch(request!.query, request!.types),
    );

    return {
        searchResults: x.data,
        searchCatalog: setRequest,
        searchCatalogLoading: x.isLoading,
        searchCatalogErr: x.error,
    };
}

/** Returns the cached songs in the user's Apple Music library. */
export function useTracksFromLibrary() {
    const x = useSWR(["MusicKit.getTracksFromLibrary"], () =>
        MusicKit.getTracksFromLibrary(),
    );
    return {
        tracks: x.data,
        tracksLoading: x.isLoading,
        tracksErr: x.error,
    };
}

/** Returns cached Apple Music playlists for the supplied request options. */
export function useUserPlaylists(options: MusicKitOptions = {}) {
    const x = useSWR(["MusicKit.getUserPlaylists", options], ([, request]) =>
        MusicKit.getUserPlaylists(request),
    );
    return {
        playlists: x.data,
        playlistsLoading: x.isLoading,
        playlistsErr: x.error,
    };
}

/** Returns and updates the cached favorite status for one Apple Music song. */
export function useSongFavoriteStatus(songId?: string) {
    const key = songId
        ? (["MusicKit.getSongFavoriteStatus", songId] as const)
        : null;
    const x = useSWR<SongFavoriteStatus>(key, () =>
        MusicKit.getSongFavoriteStatus(songId!),
    );

    async function setSongFavoriteStatus(
        isFavorite: boolean,
    ): Promise<SongFavoriteStatus> {
        if (!songId) throw new Error("A song ID is required.");

        const update = MusicKit.setSongFavoriteStatus(songId, isFavorite);
        const nextStatus = await x.mutate(update, {
            optimisticData: { isFavorite },
            rollbackOnError: true,
            populateCache: true,
            revalidate: false,
        });
        if (!nextStatus) {
            throw new Error("Apple Music did not return a favorite status.");
        }
        return nextStatus;
    }

    return {
        favoriteStatus: x.data,
        favoriteStatusLoading: x.isLoading,
        favoriteStatusErr: x.error,
        setSongFavoriteStatus,
    };
}

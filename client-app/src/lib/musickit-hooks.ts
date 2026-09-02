import {
    MusicKit,
    MusicKitOptions,
    SearchResult,
    CatalogSearchType,
} from "@apple-musickit";
import useSWR from "swr";
import { useSimpleMutation } from "./swr-utils";

export function useSongInfo(songIds: string[]) {
    const x = useSWR(["MusicKit.getSongInfo", songIds], () =>
        MusicKit.getSongInfo(songIds),
    );
    return {
        songInfo: x.data,
        songInfoLoading: x.isLoading,
        songInfoErr: x.error,
    };
}

export function useCatalogSearch() {
    const x = useSimpleMutation<
        { query: string; types: CatalogSearchType[] },
        SearchResult
    >("MusicKit.catalogSearch", ({ query, types }) => {
        return MusicKit.catalogSearch(query, types);
    });
    return {
        searchResults: x.data,
        searchCatalog: x.trigger,
        searchCatalogLoading: x.isMutating,
        searchCatalogErr: x.error,
    };
}

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

export function useUserPlaylists(options: MusicKitOptions) {
    const x = useSWR(["MusicKit.getUserPlaylists"], () =>
        MusicKit.getUserPlaylists(options),
    );
    return {
        playlists: x.data,
        playlistsLoading: x.isLoading,
        playlistsErr: x.error,
    };
}

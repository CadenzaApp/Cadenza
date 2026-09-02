import {
    type CatalogSearchType,
    type LibraryResult,
    type LibrarySongOptions,
    MusicKit,
    type MusicItem,
    type MusicKitOptions,
    type SearchResult,
    type SongFavoriteStatus,
} from "@apple-musickit";
import { useMemo, useState } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";

const MUSIC_LIST_PAGE_SIZE = 25;

type LibrarySongSort = NonNullable<LibrarySongOptions["sort"]>;
type LibraryPageKey = readonly [
    "MusicKit.getLibrarySongs",
    number,
    LibrarySongSort["option"] | null,
    LibrarySongSort["direction"] | null,
    number,
];
type SearchPageKey = readonly [
    "MusicKit.catalogSearch",
    string,
    readonly CatalogSearchType[],
    number,
    number,
];

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

/**
 * Provides an explicitly triggered, cached Apple Music catalog search with
 * incremental pages. The query and all request parameters form the cache key.
 */
export function useCatalogSearch(enabled = true) {
    const [request, setRequest] = useState<{
        query: string;
        types: readonly CatalogSearchType[];
    } | null>(null);
    const x = useSWRInfinite<SearchResult>(
        (pageIndex, previousPage) => {
            if (!enabled || !request) return null;
            if (pageIndex > 0 && !hasNextSearchPage(previousPage)) {
                return null;
            }

            return [
                "MusicKit.catalogSearch",
                request.query,
                request.types,
                MUSIC_LIST_PAGE_SIZE,
                pageIndex,
            ] as const;
        },
        (key: SearchPageKey) => {
            const [, query, types, limit, pageIndex] = key;
            return MusicKit.catalogSearch(query, [...types], {
                limit,
                offset: pageIndex * limit,
            });
        },
    );
    const searchResults = useMemo(
        () =>
            appendTracksWithoutDuplicates(
                x.data?.flatMap((page) => page.songs) ?? [],
            ),
        [x.data],
    );
    const lastPage = x.data?.[x.data.length - 1];
    const hasNextPage = hasNextSearchPage(lastPage);
    const isLoadingNextPage =
        x.isValidating &&
        Boolean(x.data?.length) &&
        x.size > (x.data?.length ?? 0);

    function searchCatalog(nextRequest: {
        query: string;
        types: CatalogSearchType[];
    }) {
        void x.setSize(1);
        setRequest({
            query: nextRequest.query.trim(),
            types: [...nextRequest.types],
        });
    }

    async function loadNextSearchPage() {
        if (!hasNextPage || isLoadingNextPage) return;
        await x.setSize((size) => size + 1);
    }

    function clearSearchCatalog() {
        setRequest(null);
        void x.setSize(1);
    }

    return {
        searchResults,
        searchCatalog,
        clearSearchCatalog,
        loadNextSearchPage,
        hasNextSearchPage: hasNextPage,
        searchCatalogLoading: x.isLoading,
        isLoadingNextSearchPage: isLoadingNextPage,
        searchCatalogErr: x.error,
    };
}

/**
 * Returns paginated library songs. iOS Date Added sorting is included in the
 * key, allowing the native MusicLibraryRequest to retain its global ordering.
 */
export function useTracksFromLibrary({
    enabled = true,
    sort,
}: {
    enabled?: boolean;
    sort?: LibrarySongSort;
} = {}) {
    const x = useSWRInfinite<LibraryResult>(
        (pageIndex, previousPage) => {
            if (!enabled) return null;
            if (pageIndex > 0 && !hasNextLibraryPage(previousPage)) {
                return null;
            }

            return [
                "MusicKit.getLibrarySongs",
                MUSIC_LIST_PAGE_SIZE,
                sort?.option ?? null,
                sort?.direction ?? null,
                pageIndex,
            ] as const;
        },
        (key: LibraryPageKey) => {
            const [, limit, sortOption, sortDirection, pageIndex] = key;
            const options: LibrarySongOptions = {
                limit,
                offset: pageIndex * limit,
            };

            if (sortOption && sortDirection) {
                options.sort = {
                    option: sortOption,
                    direction: sortDirection,
                };
            }

            return MusicKit.getLibrarySongs(options);
        },
    );
    const tracks = useMemo(
        () =>
            appendTracksWithoutDuplicates(
                x.data?.flatMap((page) => page.items) ?? [],
            ),
        [x.data],
    );
    const lastPage = x.data?.[x.data.length - 1];
    const hasNextPage = hasNextLibraryPage(lastPage);
    const isLoadingNextPage =
        x.isValidating &&
        Boolean(x.data?.length) &&
        x.size > (x.data?.length ?? 0);

    async function loadNextLibraryPage() {
        if (!hasNextPage || isLoadingNextPage) return;
        await x.setSize((size) => size + 1);
    }

    return {
        tracks,
        tracksLoading: x.isLoading,
        tracksLoadingNextPage: isLoadingNextPage,
        loadNextLibraryPage,
        hasNextLibraryPage: hasNextPage,
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

function hasNextLibraryPage(page?: LibraryResult | null) {
    return Boolean(page?.items.length && (page.next || page.hasNextPage));
}

function hasNextSearchPage(page?: SearchResult | null) {
    return Boolean(page?.songs.length && page.hasNextSongs);
}

function appendTracksWithoutDuplicates(tracks: MusicItem[]) {
    const seenTrackIDs = new Set<string>();
    return tracks.filter((track) => {
        if (seenTrackIDs.has(track.id)) return false;
        seenTrackIDs.add(track.id);
        return true;
    });
}

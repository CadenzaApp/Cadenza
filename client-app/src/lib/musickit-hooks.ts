import {
    type ArtistDetail,
    type LibraryResult,
    type LibrarySongOptions,
    MusicKit,
    type MusicItem,
    type SearchResult,
    type SongFavoriteStatus,
} from "@apple-musickit";
import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import { useAppleMusic } from "./apple-music-auth";

const MUSIC_LIST_PAGE_SIZE = 25;
/** Even number so the recently added grid never ends on a half row. */
const RECENTLY_ADDED_PAGE_SIZE = 24;

/** A library collection that contains songs. */
export type LibraryCollectionKind = "album" | "playlist";

type LibrarySongSort = NonNullable<LibrarySongOptions["sort"]>;
type LibraryPageKey = readonly [
    "MusicKit.getLibrarySongs",
    number,
    number,
    LibrarySongSort["option"] | null,
    LibrarySongSort["direction"] | null,
    number,
];
type CollectionPageKey = readonly [
    "MusicKit.getLibraryAlbums" | "MusicKit.getUserPlaylists",
    number,
    number,
    number,
];
type RecentlyAddedPageKey = readonly [
    "MusicKit.getRecentlyAdded",
    number,
    number,
    number,
];
type CollectionSongsPageKey = readonly [
    "MusicKit.getCollectionSongs",
    number,
    LibraryCollectionKind,
    string,
    number,
    number,
];
type SearchPageKey = readonly [
    "MusicKit.catalogSongSearch",
    number,
    string,
    number,
    number,
];

/** Returns cached Apple Music metadata for the supplied song IDs. */
export function useSongInfo(songIds?: readonly string[] | null) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const normalizedIds = useMemo(
        () => [...new Set(songIds?.filter(Boolean) ?? [])],
        [songIds],
    );
    const key =
        isConnected && normalizedIds.length
            ? ([
                  "MusicKit.getSongInfo",
                  sessionRevision,
                  normalizedIds,
              ] as const)
            : null;
    const x = useSWR(key, ([, , ids]) => MusicKit.getSongInfo([...ids]));
    return {
        songInfo: x.data ?? [],
        songInfoLoading: x.isLoading || isInitializing,
        songInfoErr: x.error,
    };
}

/**
 * Provides an explicitly triggered, cached Apple Music catalog search with
 * incremental pages. The query and all request parameters form the cache key.
 */
export function useCatalogSongSearch(enabled = true) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const [query, setQuery] = useState<string | null>(null);
    const x = useSWRInfinite<SearchResult>(
        (pageIndex, previousPage) => {
            if (!enabled || !isConnected || !query) return null;
            if (pageIndex > 0 && !hasNextSearchPage(previousPage)) {
                return null;
            }

            const offset = pageIndex === 0 ? 0 : previousPage?.nextSongsOffset;
            if (offset === undefined) return null;
            return [
                "MusicKit.catalogSongSearch",
                sessionRevision,
                query,
                MUSIC_LIST_PAGE_SIZE,
                offset,
            ] as const;
        },
        (key: SearchPageKey) => {
            const [, , searchQuery, limit, offset] = key;
            return MusicKit.catalogSearch(searchQuery, ["songs"], {
                limit,
                offset,
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

    function searchCatalog(nextQuery: string) {
        setQuery(nextQuery.trim() || null);
    }

    async function loadNextSearchPage() {
        if (!hasNextPage || isLoadingNextPage) return;
        await x.setSize((size) => size + 1);
    }

    function clearSearchCatalog() {
        setQuery(null);
    }

    return {
        searchResults,
        searchCatalog,
        clearSearchCatalog,
        loadNextSearchPage,
        hasNextSearchPage: hasNextPage,
        searchCatalogLoading: x.isLoading || isInitializing,
        isLoadingNextSearchPage: isLoadingNextPage,
        searchCatalogErr: x.error,
    };
}

/**
 * Pages through any Apple Music library collection. `getKey` is handed the
 * offset of the page being requested and returns the SWR key for it, or null
 * when the read is not authorized or its inputs are missing.
 *
 * Every library read is the same loop: request a page, read `nextOffset` off
 * it, stop when the native side says there is no next page. This owns that
 * loop so the individual hooks are only a key and a fetch.
 */
function usePagedLibraryResult<Key extends readonly unknown[]>(
    getKey: (offset: number) => Key | null,
    fetchPage: (key: Key) => Promise<LibraryResult>,
) {
    const x = useSWRInfinite<LibraryResult>(
        (pageIndex, previousPage: LibraryResult | null) => {
            if (pageIndex > 0 && !hasNextLibraryPage(previousPage)) return null;
            const offset = pageIndex === 0 ? 0 : previousPage?.nextOffset;
            if (offset === undefined) return null;
            return getKey(offset);
        },
        (key) => fetchPage(key as unknown as Key),
    );

    const items = useMemo(
        () =>
            appendTracksWithoutDuplicates(
                x.data?.flatMap((page) => page.items) ?? [],
            ),
        [x.data],
    );
    const hasNextPage = hasNextLibraryPage(x.data?.[x.data.length - 1]);
    const isLoadingNextPage =
        x.isValidating &&
        Boolean(x.data?.length) &&
        x.size > (x.data?.length ?? 0);

    async function loadNextPage() {
        if (!hasNextPage || isLoadingNextPage) return;
        await x.setSize((size) => size + 1);
    }

    return {
        items,
        isLoading: x.isLoading,
        isLoadingNextPage,
        loadNextPage,
        hasNextPage,
        error: x.error,
    };
}

/**
 * Returns paginated library songs. iOS native sorting is included in the key,
 * allowing MusicLibraryRequest to retain its global ordering across pages.
 */
export function useTracksFromLibrary({
    enabled = true,
    sort,
}: {
    enabled?: boolean;
    sort?: LibrarySongSort;
} = {}) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const page = usePagedLibraryResult(
        (offset) =>
            enabled && isConnected
                ? ([
                      "MusicKit.getLibrarySongs",
                      sessionRevision,
                      MUSIC_LIST_PAGE_SIZE,
                      sort?.option ?? null,
                      sort?.direction ?? null,
                      offset,
                  ] as const)
                : null,
        (key: LibraryPageKey) => {
            const [, , limit, sortOption, sortDirection, offset] = key;
            const options: LibrarySongOptions = { limit, offset };
            if (sortOption && sortDirection) {
                options.sort = {
                    option: sortOption,
                    direction: sortDirection,
                };
            }
            return MusicKit.getLibrarySongs(options);
        },
    );

    return {
        tracks: page.items,
        tracksLoading: page.isLoading || isInitializing,
        tracksLoadingNextPage: page.isLoadingNextPage,
        loadNextLibraryPage: page.loadNextPage,
        hasNextLibraryPage: page.hasNextPage,
        tracksErr: page.error,
    };
}

/** Returns the user's paginated library albums. */
export function useLibraryAlbums(enabled = true) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const page = usePagedLibraryResult(
        (offset) =>
            enabled && isConnected
                ? ([
                      "MusicKit.getLibraryAlbums",
                      sessionRevision,
                      MUSIC_LIST_PAGE_SIZE,
                      offset,
                  ] as const)
                : null,
        ([, , limit, offset]: CollectionPageKey) =>
            MusicKit.getLibraryAlbums({ limit, offset }),
    );

    return {
        albums: page.items,
        albumsLoading: page.isLoading || isInitializing,
        albumsLoadingNextPage: page.isLoadingNextPage,
        loadNextAlbumPage: page.loadNextPage,
        hasNextAlbumPage: page.hasNextPage,
        albumsErr: page.error,
    };
}

/** Returns the user's paginated library playlists. */
export function useUserPlaylists(enabled = true) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const page = usePagedLibraryResult(
        (offset) =>
            enabled && isConnected
                ? ([
                      "MusicKit.getUserPlaylists",
                      sessionRevision,
                      MUSIC_LIST_PAGE_SIZE,
                      offset,
                  ] as const)
                : null,
        ([, , limit, offset]: CollectionPageKey) =>
            MusicKit.getUserPlaylists({ limit, offset }),
    );

    return {
        playlists: page.items,
        playlistsLoading: page.isLoading || isInitializing,
        playlistsLoadingNextPage: page.isLoadingNextPage,
        loadNextPlaylistPage: page.loadNextPage,
        hasNextPlaylistPage: page.hasNextPage,
        playlistsErr: page.error,
    };
}

/**
 * Returns the user's recently added library items, newest first. Mixed kinds:
 * albums, playlists, and songs added on their own, the way Apple Music groups
 * them, so a whole album added at once is one item and not twelve.
 */
export function useRecentlyAdded(enabled = true) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const page = usePagedLibraryResult(
        (offset) =>
            enabled && isConnected
                ? ([
                      "MusicKit.getRecentlyAdded",
                      sessionRevision,
                      RECENTLY_ADDED_PAGE_SIZE,
                      offset,
                  ] as const)
                : null,
        ([, , limit, offset]: RecentlyAddedPageKey) =>
            MusicKit.getRecentlyAdded({ limit, offset }),
    );

    return {
        recentlyAdded: page.items,
        recentlyAddedLoading: page.isLoading || isInitializing,
        recentlyAddedLoadingNextPage: page.isLoadingNextPage,
        loadNextRecentlyAddedPage: page.loadNextPage,
        hasNextRecentlyAddedPage: page.hasNextPage,
        recentlyAddedErr: page.error,
    };
}

/**
 * Returns the paginated songs inside one library album or playlist. Callers
 * pass the kind rather than picking a hook, so a screen that renders either
 * does not have to branch.
 */
export function useCollectionSongs(
    kind: LibraryCollectionKind,
    collectionId?: string,
) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const page = usePagedLibraryResult(
        (offset) =>
            isConnected && collectionId
                ? ([
                      "MusicKit.getCollectionSongs",
                      sessionRevision,
                      kind,
                      collectionId,
                      MUSIC_LIST_PAGE_SIZE,
                      offset,
                  ] as const)
                : null,
        ([, , collectionKind, id, limit, offset]: CollectionSongsPageKey) =>
            collectionKind === "album"
                ? MusicKit.getAlbumSongs(id, { limit, offset })
                : MusicKit.getPlaylistSongs(id, { limit, offset }),
    );

    return {
        tracks: page.items,
        tracksLoading: page.isLoading || isInitializing,
        tracksLoadingNextPage: page.isLoadingNextPage,
        loadNextCollectionPage: page.loadNextPage,
        hasNextCollectionPage: page.hasNextPage,
        tracksErr: page.error,
    };
}

/** Returns and updates the cached favorite status for one Apple Music song. */
export function useSongFavoriteStatus(songId?: string) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const key =
        isConnected && songId
            ? ([
                  "MusicKit.getSongFavoriteStatus",
                  sessionRevision,
                  songId,
              ] as const)
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
        favoriteStatusLoading: x.isLoading || isInitializing,
        favoriteStatusErr: x.error,
        setSongFavoriteStatus,
    };
}

/**
 * Resolves the catalog artists credited on a song. Separate from `useArtist`
 * because the song only knows ids, and the menu needs to know whether there is
 * an artist to open before it has to load one.
 */
export function useSongArtists(songId?: string) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const key =
        isConnected && songId
            ? (["MusicKit.getSongArtists", sessionRevision, songId] as const)
            : null;
    const x = useSWR<string[]>(key, () => MusicKit.getSongArtists(songId!));

    return {
        artistIds: x.data,
        artistIdsLoading: x.isLoading || isInitializing,
        artistIdsErr: x.error,
    };
}

/** Returns one catalog artist with their top songs and albums. */
export function useArtist(artistId?: string) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const key =
        isConnected && artistId
            ? (["MusicKit.getArtist", sessionRevision, artistId] as const)
            : null;
    const x = useSWR<ArtistDetail>(key, () => MusicKit.getArtist(artistId!));

    return {
        artist: x.data,
        artistLoading: x.isLoading || isInitializing,
        artistErr: x.error,
    };
}

/**
 * Playlist writes. Both invalidate every cached playlist read, because adding
 * a track changes a playlist's track count and creating one changes the list
 * itself.
 */
export function usePlaylistMutations() {
    const { mutate } = useSWRConfig();

    function invalidatePlaylists() {
        return mutate(
            (key) =>
                Array.isArray(key) &&
                (key[0] === "MusicKit.getUserPlaylists" ||
                    key[0] === "MusicKit.getCollectionSongs"),
            undefined,
            { revalidate: true },
        );
    }

    async function addSongsToPlaylist(
        playlistId: string,
        songIds: readonly string[],
    ) {
        await MusicKit.addSongsToPlaylist(playlistId, songIds);
        await invalidatePlaylists();
    }

    async function createPlaylist(name: string, songIds: readonly string[]) {
        const playlist = await MusicKit.createPlaylist(name, songIds);
        await invalidatePlaylists();
        return playlist;
    }

    return { addSongsToPlaylist, createPlaylist };
}

function hasNextLibraryPage(page?: LibraryResult | null) {
    return Boolean(page?.items.length && page.hasNextPage);
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

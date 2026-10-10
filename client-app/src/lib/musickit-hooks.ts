import {
    type ArtistDetail,
    type ArtistItem,
    type ArtistResult,
    type CollectionFavoriteKind,
    type FavoriteStatus,
    type LibrarySongOptions,
    MusicKit,
    type MusicItem,
    type SearchResult,
    type SongFavoriteStatus,
} from "@apple-musickit";
import { useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import { isAppleMusicAuthError } from "./app-error";
import { reportAppleMusicAuthFailure, useAppleMusic } from "./apple-music-auth";

const MUSIC_LIST_PAGE_SIZE = 25;
const ALL_LIBRARY_PAGE_SIZE = 100;
/** The artist sections are rails, not paged lists, so one page is the whole thing. */
const ARTIST_SEARCH_LIMIT = 12;
/** Even number so the recently added grid never ends on a half row. */
const RECENTLY_ADDED_PAGE_SIZE = 24;

/** How long to wait before the one retry a rejected credential gets. */
const AUTH_RETRY_DELAY_MS = 400;

/**
 * Runs one Apple Music read, with a single retry if Apple rejects the
 * credentials.
 *
 * The retry is there for the races a plain failure cannot tell apart from a
 * dead token: a read that fired before `restoreNativeTokens` finished pushing
 * the stored token into the native module, or a token Apple was briefly
 * unhappy about. A genuinely expired token fails the same way twice, and that
 * second failure is what retires it, so nothing keeps replaying a credential
 * that cannot work.
 *
 * Every SWR fetcher in this file goes through here. A new read that skips it
 * will hang on a dead token instead of prompting a reconnect.
 */
async function read<T>(fetchOnce: () => Promise<T>): Promise<T> {
    try {
        return await fetchOnce();
    } catch (error) {
        if (!isAppleMusicAuthError(error)) throw error;

        await new Promise((resolve) =>
            setTimeout(resolve, AUTH_RETRY_DELAY_MS),
        );

        try {
            return await fetchOnce();
        } catch (retryError) {
            if (isAppleMusicAuthError(retryError)) {
                reportAppleMusicAuthFailure();
            }
            throw retryError;
        }
    }
}

/** A library collection that contains songs. */
export type LibraryCollectionKind = "album" | "playlist";

/**
 * The shape every paginated Apple Music read comes back in. `LibraryResult`
 * and `ArtistResult` both satisfy it, so one pager serves both.
 */
type PagedResult<Item> = {
    items: Item[];
    hasNextPage: boolean;
    nextOffset?: number;
};

/** Stable reference so an empty result does not re-render the rail every time. */
const EMPTY_ARTISTS: ArtistItem[] = [];

/** The same, for the song reads that other hooks index and re-derive from. */
const EMPTY_SONGS: MusicItem[] = [];

type LibraryArtistPageKey = readonly [
    "MusicKit.getLibraryArtists",
    number,
    number,
    number,
];

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
type LibrarySearchPageKey = readonly [
    "MusicKit.searchLibrarySongs",
    number,
    string,
    number,
    number,
];
type SongInfoPageKey = readonly [
    "MusicKit.getSongInfo",
    number,
    readonly string[],
];

/** Returns cached Apple Music metadata for the supplied song IDs. */
export function useSongInfo(songIds?: readonly string[] | null) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const normalizedIds = useMemo(
        () => [...new Set(songIds?.filter(Boolean) ?? [])],
        [songIds],
    );
    const idChunks = useMemo(
        () => chunkValues(normalizedIds, MUSIC_LIST_PAGE_SIZE),
        [normalizedIds],
    );
    const x = useSWRInfinite<MusicItem[]>(
        (pageIndex) => {
            const ids = idChunks[pageIndex];
            return isConnected && ids
                ? (["MusicKit.getSongInfo", sessionRevision, ids] as const)
                : null;
        },
        ([, , ids]: SongInfoPageKey) =>
            read(() => MusicKit.getSongInfo([...ids])),
        {
            // the chunks are independent, so ask for them all at once. one
            // after another, a 100 song list waited on four round trips
            parallel: true,
            initialSize: Math.max(1, idChunks.length),
            revalidateFirstPage: false,
        },
    );
    const { data, error, setSize, size } = x;
    useEffect(() => {
        if (idChunks.length > 0 && size !== idChunks.length) {
            void setSize(idChunks.length);
        }
    }, [idChunks.length, setSize, size]);
    const resolvedPageCount = data?.length ?? 0;
    return {
        songInfo:
            idChunks.length > 0 ? (data?.flat() ?? EMPTY_SONGS) : EMPTY_SONGS,
        songInfoLoading:
            isInitializing ||
            (isConnected &&
                idChunks.length > resolvedPageCount &&
                error == null),
        songInfoErr: error,
    };
}

function chunkValues<T>(values: readonly T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
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
            return read(() =>
                MusicKit.catalogSearch(searchQuery, ["songs"], {
                    limit,
                    offset,
                }),
            );
        },
        // a next page is only the next page, not page one again first
        { revalidateFirstPage: false },
    );
    const searchResults = useMemo(
        () =>
            appendWithoutDuplicates(
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
 * Searches the user's own library rather than the catalog. Mirrors
 * `useCatalogSongSearch`: it holds the term itself and the caller only submits
 * one, so a screen can swap between the two scopes without changing shape.
 */
export function useLibrarySongSearch(enabled = true) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const [term, setTerm] = useState<string | null>(null);
    const page = usePagedLibraryResult(
        (offset) =>
            enabled && isConnected && term
                ? ([
                      "MusicKit.searchLibrarySongs",
                      sessionRevision,
                      term,
                      MUSIC_LIST_PAGE_SIZE,
                      offset,
                  ] as const)
                : null,
        (key: LibrarySearchPageKey) => {
            const [, , searchTerm, limit, offset] = key;
            return MusicKit.searchLibrarySongs(searchTerm, { limit, offset });
        },
    );

    function searchLibrary(nextTerm: string) {
        setTerm(nextTerm.trim() || null);
    }

    function clearLibrarySearch() {
        setTerm(null);
    }

    return {
        librarySearchResults: page.items,
        searchLibrary,
        clearLibrarySearch,
        loadNextLibrarySearchPage: page.loadNextPage,
        hasNextLibrarySearchPage: page.hasNextPage,
        librarySearchLoading: page.isLoading || isInitializing,
        isLoadingNextLibrarySearchPage: page.isLoadingNextPage,
        librarySearchErr: page.error,
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
function usePagedLibraryResult<
    Key extends readonly unknown[],
    Item extends { id: string } = MusicItem,
>(
    getKey: (offset: number) => Key | null,
    fetchPage: (key: Key) => Promise<PagedResult<Item>>,
) {
    const x = useSWRInfinite<PagedResult<Item>>(
        (pageIndex, previousPage: PagedResult<Item> | null) => {
            if (pageIndex > 0 && !hasNextLibraryPage(previousPage)) return null;
            const offset = pageIndex === 0 ? 0 : previousPage?.nextOffset;
            if (offset === undefined) return null;
            return getKey(offset);
        },
        (key) => read(() => fetchPage(key as unknown as Key)),
        // a next page is only the next page. by default SWR fetches page one
        // again first and waits for it, which doubled every load more
        { revalidateFirstPage: false },
    );

    const items = useMemo(
        () =>
            appendWithoutDuplicates(
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

/** Returns every song in the current Apple Music library as one cached read. */
export function useAllTracksFromLibrary(enabled = true) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const x = useSWR(
        enabled && isConnected
            ? (["MusicKit.getAllLibrarySongs", sessionRevision] as const)
            : null,
        async () => {
            const pages: MusicItem[] = [];
            let offset = 0;

            while (true) {
                const page = await read(() =>
                    MusicKit.getLibrarySongs({
                        limit: ALL_LIBRARY_PAGE_SIZE,
                        offset,
                    }),
                );
                pages.push(...page.items);
                if (!hasNextLibraryPage(page)) break;

                const nextOffset =
                    page.nextOffset ?? offset + page.items.length;
                if (nextOffset <= offset) {
                    throw new Error(
                        "Apple Music returned an invalid library page offset.",
                    );
                }
                offset = nextOffset;
            }

            return appendWithoutDuplicates(pages);
        },
        {
            // the whole library is one page per hundred songs, plus a request
            // each to fill them in. SWR's default refetches it whenever a new
            // reader mounts, which kept a library download running behind
            // every page. a new Apple Music session still refetches it
            revalidateIfStale: false,
            revalidateOnFocus: false,
            revalidateOnReconnect: false,
        },
    );

    return {
        allLibraryTracks: x.data ?? EMPTY_SONGS,
        allLibraryTracksLoading: x.isLoading || isInitializing,
        allLibraryTracksErr: x.error,
        isLibraryConnected: isConnected,
    };
}

/**
 * Turns song ids from the backend into Apple Music tracks, in the order they
 * were given.
 *
 * The cached library read resolves most ids without a request, and anything it
 * does not hold falls back to `getSongInfo`. Both steps index a track under
 * every id it carries, because a song id that crossed into the backend may be
 * the catalog id or the library id: Apple only attaches a catalog id to a
 * library row when it can resolve one, so the same song can reach `user_songs`
 * under either. Matching on one of them alone silently drops the song.
 *
 * The fallback also covers a song that is in a playlist but not in the library,
 * which the library read never sees at all.
 */
export function useTracksForSongIds(songIds: readonly string[]) {
    const {
        allLibraryTracks,
        allLibraryTracksLoading,
        allLibraryTracksErr,
        isLibraryConnected,
    } = useAllTracksFromLibrary();
    const libraryTracksById = useMemo(
        () => indexTracksById(allLibraryTracks),
        [allLibraryTracks],
    );
    const unresolvedIds = useMemo(
        () => songIds.filter((id) => !libraryTracksById.has(id)),
        [libraryTracksById, songIds],
    );
    const { songInfo, songInfoLoading, songInfoErr } =
        useSongInfo(unresolvedIds);
    const fetchedTracksById = useMemo(
        () => indexTracksById(songInfo),
        [songInfo],
    );
    const tracks = useMemo(
        () =>
            songIds.flatMap((id) => {
                const track =
                    libraryTracksById.get(id) ?? fetchedTracksById.get(id);
                return track ? [track] : [];
            }),
        [fetchedTracksById, libraryTracksById, songIds],
    );

    return {
        tracks,
        tracksLoading:
            tracks.length < songIds.length &&
            (allLibraryTracksLoading ||
                (unresolvedIds.length > 0 && songInfoLoading)),
        tracksErr: allLibraryTracksErr ?? songInfoErr,
        isLibraryConnected,
    };
}

/** Indexes tracks under every id they carry, so either keyspace finds them. */
export function indexTracksById(tracks: readonly MusicItem[]) {
    const tracksById = new Map<string, MusicItem>();
    for (const track of tracks) {
        for (const id of [track.id, track.catalogId, track.libraryId]) {
            if (id) tracksById.set(id, track);
        }
    }
    return tracksById;
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
/** Returns the user's paginated library artists. */
export function useLibraryArtists(enabled = true) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const page = usePagedLibraryResult<LibraryArtistPageKey, ArtistItem>(
        (offset) =>
            enabled && isConnected
                ? ([
                      "MusicKit.getLibraryArtists",
                      sessionRevision,
                      MUSIC_LIST_PAGE_SIZE,
                      offset,
                  ] as const)
                : null,
        (key: LibraryArtistPageKey) => {
            const [, , limit, offset] = key;
            return MusicKit.getLibraryArtists({ limit, offset });
        },
    );

    return {
        artists: page.items,
        artistsLoading: page.isLoading || isInitializing,
        artistsLoadingNextPage: page.isLoadingNextPage,
        loadNextArtistsPage: page.loadNextPage,
        hasNextArtistsPage: page.hasNextPage,
        artistsErr: page.error,
    };
}

/**
 * Catalog artists matching a term. Unlike the two song searches, this takes the
 * term as an argument rather than holding it: the caller already owns the
 * submitted term, and a second copy in here would be one more thing to keep in
 * sync. One page only, because the results render as a rail.
 */
export function useCatalogArtistSearch(term?: string, enabled = true) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const normalizedTerm = term?.trim();
    const key =
        enabled && isConnected && normalizedTerm
            ? ([
                  "MusicKit.catalogArtistSearch",
                  sessionRevision,
                  normalizedTerm,
                  ARTIST_SEARCH_LIMIT,
              ] as const)
            : null;
    const x = useSWR<SearchResult>(key, () =>
        read(() =>
            MusicKit.catalogSearch(normalizedTerm!, ["artists"], {
                limit: ARTIST_SEARCH_LIMIT,
            }),
        ),
    );

    return {
        artists: x.data?.artists ?? EMPTY_ARTISTS,
        artistsLoading: x.isLoading || isInitializing,
        artistsErr: x.error,
    };
}

/** The library counterpart to `useCatalogArtistSearch`. Same surface. */
export function useLibraryArtistSearch(term?: string, enabled = true) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const normalizedTerm = term?.trim();
    const key =
        enabled && isConnected && normalizedTerm
            ? ([
                  "MusicKit.searchLibraryArtists",
                  sessionRevision,
                  normalizedTerm,
                  ARTIST_SEARCH_LIMIT,
              ] as const)
            : null;
    const x = useSWR<ArtistResult>(key, () =>
        read(() =>
            MusicKit.searchLibraryArtists(normalizedTerm!, {
                limit: ARTIST_SEARCH_LIMIT,
            }),
        ),
    );

    return {
        artists: x.data?.items ?? EMPTY_ARTISTS,
        artistsLoading: x.isLoading || isInitializing,
        artistsErr: x.error,
    };
}

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

/**
 * `useCollectionSongs` for `collectionId`, or for `fallbackId` once that one
 * fails or comes back empty. `collectionId` in the result is the one shown.
 */
export function useCollectionSongsOrFallback(
    kind: LibraryCollectionKind,
    collectionId?: string,
    fallbackId?: string,
) {
    const primary = useCollectionSongs(kind, collectionId);
    const missing =
        fallbackId != null &&
        !primary.tracksLoading &&
        (primary.tracksErr != null || primary.tracks.length === 0);
    const fallback = useCollectionSongs(kind, missing ? fallbackId : undefined);
    return missing
        ? { ...fallback, collectionId: fallbackId }
        : { ...primary, collectionId };
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
        read(() => MusicKit.getSongFavoriteStatus(songId!)),
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

function collectionFavoriteKind(
    kind: LibraryCollectionKind,
): CollectionFavoriteKind {
    return kind === "album" ? "albums" : "playlists";
}

/** Returns and updates the cached favorite status for one album or playlist. */
export function useCollectionFavoriteStatus(
    kind: LibraryCollectionKind,
    collectionId?: string,
) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const apiKind = collectionFavoriteKind(kind);
    const key =
        isConnected && collectionId
            ? ([
                  "MusicKit.getCollectionFavoriteStatus",
                  sessionRevision,
                  apiKind,
                  collectionId,
              ] as const)
            : null;
    const x = useSWR<FavoriteStatus>(key, () =>
        read(() =>
            MusicKit.getCollectionFavoriteStatus(apiKind, collectionId!),
        ),
    );

    async function setCollectionFavoriteStatus(
        isFavorite: boolean,
    ): Promise<FavoriteStatus> {
        if (!collectionId) throw new Error("A collection ID is required.");

        const update = MusicKit.setCollectionFavoriteStatus(
            apiKind,
            collectionId,
            isFavorite,
        );
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
        setCollectionFavoriteStatus,
    };
}

/** Returns metadata (title, artwork, share URL) for the album or playlist itself. */
export function useCollectionInfo(
    kind: LibraryCollectionKind,
    collectionId?: string,
) {
    const ids = useMemo(
        () => (collectionId ? [collectionId] : NO_IDS),
        [collectionId],
    );
    const { collections, collectionsLoading, collectionsErr } =
        useCollectionsInfo(kind, ids);

    return {
        collection: collections[0],
        collectionLoading: collectionsLoading,
        collectionErr: collectionsErr,
    };
}

/**
 * Returns metadata for many albums or playlists in one request, in the order
 * asked, minus any Apple Music could not find. Ids may be catalog or library.
 */
export function useCollectionsInfo(
    kind: LibraryCollectionKind,
    collectionIds: readonly string[],
) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const apiKind = collectionFavoriteKind(kind);
    const key =
        isConnected && collectionIds.length > 0
            ? ([
                  "MusicKit.getCollectionInfo",
                  sessionRevision,
                  apiKind,
                  ...collectionIds,
              ] as const)
            : null;
    const x = useSWR<MusicItem[]>(key, () =>
        read(() => MusicKit.getCollectionInfo(apiKind, [...collectionIds])),
    );

    return {
        collections: x.data ?? EMPTY_COLLECTIONS,
        collectionsLoading: x.isLoading || isInitializing,
        collectionsErr: x.error,
    };
}

const NO_IDS: readonly string[] = [];
const EMPTY_COLLECTIONS: MusicItem[] = [];

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
    const x = useSWR<string[]>(key, () =>
        read(() => MusicKit.getSongArtists(songId!)),
    );

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
    const x = useSWR<ArtistDetail>(key, () =>
        read(() => MusicKit.getArtist(artistId!)),
    );

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

function hasNextLibraryPage(page?: PagedResult<{ id: string }> | null) {
    return Boolean(page?.items.length && page.hasNextPage);
}

function hasNextSearchPage(page?: SearchResult | null) {
    return Boolean(page?.songs.length && page.hasNextSongs);
}

function appendWithoutDuplicates<Item extends { id: string }>(items: Item[]) {
    const seenIDs = new Set<string>();
    return items.filter((item) => {
        if (seenIDs.has(item.id)) return false;
        seenIDs.add(item.id);
        return true;
    });
}

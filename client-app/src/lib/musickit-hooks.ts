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
import { Image } from "expo-image";
import { useArtworkTint } from "./artwork-color";
import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import useSWR, { unstable_serialize, useSWRConfig } from "swr";
import useSWRImmutable from "swr/immutable";
import useSWRInfinite from "swr/infinite";
import { isAppleMusicAuthError } from "./app-error";
import {
    getAppleMusicAuthGeneration,
    reportAppleMusicAuthFailure,
    useAppleMusic,
} from "./apple-music-auth";
import { useListeningEvents } from "./listening-events";
import { collectionRoute } from "./music-routes";
import {
    catalogIdsToFetch,
    nextGroupedChunk,
    resolvedTracks,
    uniqueBy,
} from "./paged-tracks";

const MUSIC_LIST_PAGE_SIZE = 25;
/**
 * A paged list's first page stays small, so its rows show up fast. Every page
 * after it is as big as Apple allows, so a long list pages in two or three
 * steps rather than one per 25 songs, each step re-rendering the list.
 */
const FIRST_PAGE_SIZE = MUSIC_LIST_PAGE_SIZE;
const NEXT_PAGE_SIZE = 100;
/**
 * Song ids `usePagedTracksForSongIds` resolves per page. A whole number of
 * `MUSIC_LIST_PAGE_SIZE` chunks, so a page never splits a chunk.
 */
const SONG_ID_PAGE_SIZE = MUSIC_LIST_PAGE_SIZE * 2;
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
    const readGeneration = getAppleMusicAuthGeneration();
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
                reportAppleMusicAuthFailure(readGeneration);
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
/** Stable reference, so a list with nothing to fetch does not rerender its readers. */
const EMPTY_SONG_IDS: string[] = [];

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
    const normalizedIds = useMemo(
        () => [...new Set(songIds?.filter(Boolean) ?? [])],
        [songIds],
    );
    const idChunks = useMemo(
        () => chunkValues(normalizedIds, MUSIC_LIST_PAGE_SIZE),
        [normalizedIds],
    );
    return useSongInfoChunks(idChunks);
}

/**
 * The same read as `useSongInfo`, for a caller that splits its ids into
 * requests itself. Each chunk is cached by its ids, so a chunk asked for again,
 * in any position or by another reader, is answered from the cache rather than
 * reloaded.
 *
 * `useSWRInfinite` keeps its page count under its first page's key. If that
 * were a chunk, two readers starting with the same chunk but holding a
 * different number of them (a group of a sorted list and the player looking up
 * the song playing, say) would share one count, set it back and forth, and
 * refetch forever. So the first page is this reader's own, answered with no
 * request, and the chunks come after it. It carries the chunks' ids too, since
 * a new first page key is what tells `useSWRInfinite` the chunks changed.
 */
function useSongInfoChunks(idChunks: readonly (readonly string[])[]) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const reader = useId();
    const active = isConnected && idChunks.length > 0;
    const chunkIds = useMemo(
        () => idChunks.map((ids) => ids.join(",")).join("|"),
        [idChunks],
    );
    const x = useSWRInfinite<MusicItem[]>(
        (pageIndex) => {
            if (!active) return null;
            if (pageIndex === 0) {
                return [SONG_INFO_READER, reader, chunkIds] as const;
            }
            const ids = idChunks[pageIndex - 1];
            return ids
                ? (["MusicKit.getSongInfo", sessionRevision, ids] as const)
                : null;
        },
        (key: SongInfoPageKey | SongInfoReaderKey) =>
            key[0] === SONG_INFO_READER
                ? Promise.resolve(EMPTY_SONGS)
                : read(() => MusicKit.getSongInfo([...key[2]])),
        {
            // the chunks are independent, so ask for them all at once. one
            // after another, a 100 song list waited on four round trips
            parallel: true,
            initialSize: idChunks.length + 1,
            revalidateFirstPage: false,
        },
    );
    const { data, error, setSize, size } = x;
    const { cache } = useSWRConfig();
    useEffect(() => {
        if (active && size !== idChunks.length + 1) {
            void setSize(idChunks.length + 1);
        }
    }, [active, idChunks.length, setSize, size]);
    // one entry per chunk, after the reader's own page. new chunks give the
    // reader a new key, which has no data until it loads, so a chunk already
    // answered is read straight from its own cache entry meanwhile. a list
    // that opens one more group then never blanks the groups already open
    const chunkPages = useMemo(
        () =>
            idChunks.map(
                (ids, index): MusicItem[] | undefined =>
                    data?.[index + 1] ??
                    (cache.get(
                        unstable_serialize([
                            "MusicKit.getSongInfo",
                            sessionRevision,
                            ids,
                        ]),
                    )?.data as MusicItem[] | undefined),
            ),
        [cache, data, idChunks, sessionRevision],
    );
    const chunksLoaded = useMemo(
        () => chunkPages.map((page) => page !== undefined),
        [chunkPages],
    );
    const songInfo = useMemo(
        () =>
            chunkPages.length > 0
                ? chunkPages.flatMap((page) => page ?? [])
                : EMPTY_SONGS,
        [chunkPages],
    );
    return {
        songInfo: idChunks.length > 0 ? songInfo : EMPTY_SONGS,
        songInfoLoading:
            isInitializing ||
            (isConnected &&
                chunksLoaded.some((loaded) => !loaded) &&
                error == null),
        songInfoErr: error,
        /** Whether each chunk has its answer, in the order given. */
        chunksLoaded,
    };
}

/** Marks a `useSongInfoChunks` reader's own first page. */
const SONG_INFO_READER = "MusicKit.getSongInfo.reader";
type SongInfoReaderKey = readonly [typeof SONG_INFO_READER, string, string];

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
        (offset, limit) =>
            enabled && isConnected && term
                ? ([
                      "MusicKit.searchLibrarySongs",
                      sessionRevision,
                      term,
                      limit,
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
    /** `limit` is the pager's page size for that page, for the key. */
    getKey: (offset: number, limit: number) => Key | null,
    fetchPage: (key: Key) => Promise<PagedResult<Item>>,
) {
    const x = useSWRInfinite<PagedResult<Item>>(
        (pageIndex, previousPage: PagedResult<Item> | null) => {
            if (pageIndex > 0 && !hasNextLibraryPage(previousPage)) return null;
            const offset = pageIndex === 0 ? 0 : previousPage?.nextOffset;
            if (offset === undefined) return null;
            return getKey(
                offset,
                pageIndex === 0 ? FIRST_PAGE_SIZE : NEXT_PAGE_SIZE,
            );
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
        (offset, limit) =>
            enabled && isConnected
                ? ([
                      "MusicKit.getLibrarySongs",
                      sessionRevision,
                      limit,
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

/**
 * Like `useTracksForSongIds`, but for a list long enough that it should not all
 * be resolved at once: only the first `SONG_ID_PAGE_SIZE` ids are turned into
 * tracks, and `loadNextPage` adds the next page as the list scrolls. A new
 * `songIds` array starts over at one page, so keep it referentially stable.
 *
 * Rows only ever append. An id still being looked up ends `tracks` until its
 * answer arrives, an id Apple Music cannot see is left out, and two ids for the
 * same track show it once. See `@/lib/paged-tracks`.
 *
 * `resolveTracks` turns any ids into tracks on demand, for a caller that needs
 * ids the list has not reached yet, like a play queue. It reuses what is
 * already resolved and asks Apple Music once for the rest. If that ask fails it
 * returns what it already had rather than nothing.
 */
export function usePagedTracksForSongIds(
    songIds: readonly string[],
    /** False reads nothing, not even the library, for a caller with no list. */
    enabled = true,
) {
    const { isConnected } = useAppleMusic();
    const {
        allLibraryTracks,
        allLibraryTracksLoading,
        allLibraryTracksErr,
        isLibraryConnected,
    } = useAllTracksFromLibrary(enabled);
    const libraryTracksById = useMemo(
        () => indexTracksById(allLibraryTracks),
        [allLibraryTracks],
    );
    // the page count belongs to one id list, so a new list starts at one page
    const [paging, setPaging] = useState({ songIds, pageCount: 1 });
    const pageCount = paging.songIds === songIds ? paging.pageCount : 1;
    const requestedCount = Math.min(
        songIds.length,
        pageCount * SONG_ID_PAGE_SIZE,
    );
    // asking before the library has loaded would send Apple ids the library
    // is about to resolve, and then the chunks would change under the list
    const catalogIds = useMemo(
        () =>
            allLibraryTracksLoading
                ? EMPTY_SONG_IDS
                : catalogIdsToFetch(
                      songIds,
                      requestedCount,
                      (songId) => libraryTracksById.has(songId),
                      MUSIC_LIST_PAGE_SIZE,
                  ),
        [allLibraryTracksLoading, libraryTracksById, requestedCount, songIds],
    );
    const { songInfo, songInfoLoading, songInfoErr } = useSongInfo(catalogIds);
    const fetchedTracksById = useMemo(
        () => indexTracksById(songInfo),
        [songInfo],
    );
    const pending = allLibraryTracksLoading || songInfoLoading;
    const { tracks, consumedCount } = useMemo(
        () =>
            resolvedTracks(
                songIds,
                requestedCount,
                (songId) =>
                    libraryTracksById.get(songId) ??
                    fetchedTracksById.get(songId),
                (track) => track.id,
                pending,
            ),
        [
            fetchedTracksById,
            libraryTracksById,
            pending,
            requestedCount,
            songIds,
        ],
    );
    const loadNextPage = useCallback(() => {
        setPaging((current) => ({
            songIds,
            pageCount:
                (current.songIds === songIds ? current.pageCount : 1) + 1,
        }));
    }, [songIds]);
    const resolveTracks = useCallback(
        async (ids: readonly string[]) => {
            const known = (songId: string) =>
                libraryTracksById.get(songId) ?? fetchedTracksById.get(songId);
            const missing = ids.filter((songId) => !known(songId));
            let fetched = new Map<string, MusicItem>();
            if (missing.length > 0 && isConnected) {
                try {
                    fetched = indexTracksById(
                        await read(() => MusicKit.getSongInfo(missing)),
                    );
                } catch (error) {
                    // the tracks already resolved are still worth playing
                    console.error("Could not resolve songs to play:", error);
                }
            }
            return uniqueBy(
                ids.flatMap((songId) => {
                    const track = known(songId) ?? fetched.get(songId);
                    return track ? [track] : [];
                }),
                (track) => track.id,
            );
        },
        [fetchedTracksById, isConnected, libraryTracksById],
    );

    return {
        tracks,
        /** How many ids from the top have been resolved or given up on. */
        loadedCount: consumedCount,
        tracksLoading: pending && tracks.length === 0 && requestedCount > 0,
        isLoadingNextPage: pending && tracks.length > 0,
        hasNextPage: requestedCount < songIds.length,
        loadNextPage,
        resolveTracks,
        tracksErr: allLibraryTracksErr ?? songInfoErr,
        isLibraryConnected,
    };
}

/**
 * Turns song ids into tracks: the library's first, which costs nothing once it
 * has loaded, then Apple Music for the rest. For one-off work like filling in
 * what the backend is missing, not for a list that renders as it scrolls.
 */
export function useTrackLookup(enabled = true) {
    const { isConnected } = useAppleMusic();
    const { allLibraryTracks } = useAllTracksFromLibrary(enabled);
    const libraryTracksById = useMemo(
        () => indexTracksById(allLibraryTracks),
        [allLibraryTracks],
    );
    return useCallback(
        async (songIds: readonly string[]) => {
            const found = new Map<string, MusicItem>();
            const missing: string[] = [];
            for (const songId of songIds) {
                const track = libraryTracksById.get(songId);
                if (track) found.set(songId, track);
                else missing.push(songId);
            }
            if (missing.length === 0 || !isConnected) return found;
            for (const chunk of chunkValues(missing, MUSIC_LIST_PAGE_SIZE)) {
                const fetched = indexTracksById(
                    await read(() => MusicKit.getSongInfo(chunk)),
                );
                for (const songId of chunk) {
                    const track = fetched.get(songId);
                    if (track) found.set(songId, track);
                }
            }
            return found;
        },
        [isConnected, libraryTracksById],
    );
}

/** How many songs one background request of a grouped list asks Apple for. */
const GROUPED_CHUNK_SIZE = MUSIC_LIST_PAGE_SIZE;
/** How many of those requests run at once. */
const GROUPED_PARALLEL_CHUNKS = 2;
/** Tries a chunk gets before its songs are left out as ones Apple cannot find. */
const GROUPED_CHUNK_ATTEMPTS = 3;
const GROUPED_RETRY_DELAY_MS = 2000;

type GroupedStore = {
    /** The Apple Music session these answers belong to. */
    sessionRevision: number;
    /** Tracks fetched from Apple, by every id they carry. */
    found: ReadonlyMap<string, MusicItem>;
    /** Ids looked up, found or not. A settled id is never asked about again. */
    settled: ReadonlySet<string>;
};

/**
 * Tracks for a grouped list, all of it, loaded once in the background and
 * kept for as long as the screen is open. Opening or closing a group only
 * reads what is here, so it never reloads the groups already showing.
 *
 * The library resolves most songs for free; the rest are asked of Apple 25 at
 * a time, two requests at once, walking the groups top down from
 * `startGroup` (`nextGroupedChunk`). The caller moves `startGroup` to a group
 * the user opens, so it is next, and the walk carries on from there. Each
 * chunk's tracks go to `afterChunk` once they are in, to warm their tags.
 *
 * A failed request is tried again after a pause, three times in all, and
 * then those songs are left out like ones Apple has no entry for.
 */
export function useGroupedTrackLoader({
    groups,
    startGroup,
    enabled,
    afterChunk,
}: {
    groups: readonly (readonly string[])[] | null;
    startGroup: number;
    enabled: boolean;
    afterChunk?: (tracks: MusicItem[]) => Promise<void>;
}) {
    const { isConnected, sessionRevision } = useAppleMusic();
    const { allLibraryTracks, allLibraryTracksLoading, allLibraryTracksErr } =
        useAllTracksFromLibrary(enabled);
    const libraryTracksById = useMemo(
        () => indexTracksById(allLibraryTracks),
        [allLibraryTracks],
    );
    const [store, setStore] = useState<GroupedStore>(() => ({
        sessionRevision,
        found: new Map(),
        settled: new Set(),
    }));
    // a new Apple Music session starts over
    const current =
        store.sessionRevision === sessionRevision
            ? store
            : { sessionRevision, found: EMPTY_FOUND, settled: EMPTY_SETTLED };
    const latestRevision = useRef(sessionRevision);
    useEffect(() => {
        latestRevision.current = sessionRevision;
    }, [sessionRevision]);
    const inFlight = useRef(new Set<string>());
    // what the store will hold once React applies it, read by the scheduler.
    // the store itself is state, and a scheduling pass from an earlier render
    // can run after a chunk has left `inFlight` but before the store shows it
    // settled, which would ask for the chunk again
    const settledNow = useRef<{ revision: number; ids: Set<string> }>({
        revision: sessionRevision,
        ids: new Set(),
    });
    const attempts = useRef(new Map<string, number>());
    const running = useRef(0);
    const mounted = useRef(true);
    const [wake, setWake] = useState(0);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    useEffect(() => {
        if (!enabled || !groups || !isConnected || allLibraryTracksLoading) {
            return;
        }
        if (settledNow.current.revision !== sessionRevision) {
            settledNow.current = { revision: sessionRevision, ids: new Set() };
        }
        const settled = settledNow.current.ids;
        while (running.current < GROUPED_PARALLEL_CHUNKS) {
            const chunk = nextGroupedChunk(
                groups,
                startGroup,
                (songId) => settled.has(songId) || inFlight.current.has(songId),
                GROUPED_CHUNK_SIZE,
            );
            if (chunk.length === 0) break;
            for (const songId of chunk) inFlight.current.add(songId);
            running.current += 1;
            void (async () => {
                const toFetch = chunk.filter(
                    (songId) => !libraryTracksById.has(songId),
                );
                let fetched = new Map<string, MusicItem>();
                let failed = false;
                if (toFetch.length > 0) {
                    try {
                        fetched = indexTracksById(
                            await read(() => MusicKit.getSongInfo(toFetch)),
                        );
                    } catch (error) {
                        console.error(
                            "Could not load songs for a grouped list:",
                            error,
                        );
                        failed = true;
                    }
                }
                const tries = (attempts.current.get(chunk[0]) ?? 0) + 1;
                const settle = !failed || tries >= GROUPED_CHUNK_ATTEMPTS;
                // an answer from a session that has since been replaced is
                // dropped. the new session asks again
                const current = latestRevision.current === sessionRevision;
                if (settle && current) {
                    for (const songId of chunk) settled.add(songId);
                }
                if (settle && mounted.current && current) {
                    setStore((previous) => {
                        const same =
                            previous.sessionRevision === sessionRevision;
                        const found = new Map(same ? previous.found : []);
                        for (const [songId, track] of fetched) {
                            found.set(songId, track);
                        }
                        const nextSettled = new Set(
                            same ? previous.settled : [],
                        );
                        for (const songId of chunk) nextSettled.add(songId);
                        return {
                            sessionRevision,
                            found,
                            settled: nextSettled,
                        };
                    });
                }
                if (settle) {
                    const tracks = chunk.flatMap((songId) => {
                        const track =
                            libraryTracksById.get(songId) ??
                            fetched.get(songId);
                        return track ? [track] : [];
                    });
                    // one chunk's tags at a time per slot, so a large list
                    // never sends the backend a burst
                    try {
                        await afterChunk?.(tracks);
                    } catch {
                        // the rows ask again for anything this missed
                    }
                } else {
                    attempts.current.set(chunk[0], tries);
                    await new Promise((resolve) =>
                        setTimeout(resolve, GROUPED_RETRY_DELAY_MS),
                    );
                }
                for (const songId of chunk) inFlight.current.delete(songId);
                running.current -= 1;
                if (mounted.current) setWake((count) => count + 1);
            })();
        }
    }, [
        afterChunk,
        allLibraryTracksLoading,
        enabled,
        groups,
        isConnected,
        libraryTracksById,
        sessionRevision,
        startGroup,
        wake,
    ]);

    const found = current.found;
    const settled = current.settled;
    const trackFor = useCallback(
        (songId: string) => libraryTracksById.get(songId) ?? found.get(songId),
        [found, libraryTracksById],
    );
    const isSettled = useCallback(
        (songId: string) =>
            libraryTracksById.has(songId) || settled.has(songId),
        [libraryTracksById, settled],
    );

    return {
        trackFor,
        isSettled,
        /** Nothing can be shown until the library, which most songs come from, is in. */
        libraryLoading: enabled && allLibraryTracksLoading,
        tracksErr: allLibraryTracksErr,
    };
}

const EMPTY_FOUND: ReadonlyMap<string, MusicItem> = new Map();
const EMPTY_SETTLED: ReadonlySet<string> = new Set();

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
        (offset, limit) =>
            enabled && isConnected
                ? ([
                      "MusicKit.getLibraryAlbums",
                      sessionRevision,
                      limit,
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
        (offset, limit) =>
            enabled && isConnected
                ? ([
                      "MusicKit.getUserPlaylists",
                      sessionRevision,
                      limit,
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
        (offset, limit) =>
            isConnected && collectionId
                ? collectionSongsKey(
                      sessionRevision,
                      kind,
                      collectionId,
                      limit,
                      offset,
                  )
                : null,
        // a page prefetched on press-in is already on its way; join it
        (key: CollectionSongsPageKey) =>
            prefetching.get(unstable_serialize(key)) ??
            fetchCollectionSongs(key),
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

function collectionSongsKey(
    sessionRevision: number,
    kind: LibraryCollectionKind,
    collectionId: string,
    limit: number,
    offset: number,
): CollectionSongsPageKey {
    return [
        "MusicKit.getCollectionSongs",
        sessionRevision,
        kind,
        collectionId,
        limit,
        offset,
    ] as const;
}

function fetchCollectionSongs([
    ,
    ,
    kind,
    id,
    limit,
    offset,
]: CollectionSongsPageKey) {
    return kind === "album"
        ? MusicKit.getAlbumSongs(id, { limit, offset })
        : MusicKit.getPlaylistSongs(id, { limit, offset });
}

/** First pages requested on press-in and not landed yet, by cache key. */
const prefetching = new Map<string, Promise<PagedResult<MusicItem>>>();

/**
 * Starts loading a collection's first page as a finger lands on it, so the
 * request is underway during the tap and the screen's open. The page lands in
 * the cache under the same key `useCollectionSongs` asks for, and a screen
 * that mounts while it is still in flight joins that request rather than
 * sending its own.
 */
export function usePrefetchCollectionSongs() {
    const { isConnected, sessionRevision } = useAppleMusic();
    const { cache, mutate } = useSWRConfig();
    return useCallback(
        (collection: MusicItem) => {
            // the same kind and id the screen will open with
            const { kind, id } = collectionRoute(collection).params;
            if (!isConnected || !id) return;
            if (kind !== "album" && kind !== "playlist") return;
            const key = collectionSongsKey(
                sessionRevision,
                kind,
                id,
                FIRST_PAGE_SIZE,
                0,
            );
            const cacheKey = unstable_serialize(key);
            if (
                cache.get(cacheKey)?.data !== undefined ||
                prefetching.has(cacheKey)
            ) {
                return;
            }
            const request = read(() => fetchCollectionSongs(key));
            prefetching.set(cacheKey, request);
            void (async () => {
                try {
                    await mutate(key, await request, { revalidate: false });
                } catch {
                    // the screen's own read reports it
                } finally {
                    prefetching.delete(cacheKey);
                }
            })();
        },
        [cache, isConnected, mutate, sessionRevision],
    );
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

/**
 * Returns and updates the cached favorite status for one Apple Music song.
 *
 * A change that Apple Music accepts is also logged as a `song_favorited` or
 * `song_unfavorited` event, which is how the backend's Favorited activity tag
 * learns about it. Apple Music owns favorites, so a change made outside Cadenza
 * never reaches that tag. `songId` should be the id tags use,
 * `catalogId ?? id`, so the tag lands on the same song.
 */
export function useSongFavoriteStatus(songId?: string) {
    const { isConnected, isInitializing, sessionRevision } = useAppleMusic();
    const { recordEvent } = useListeningEvents();
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
        try {
            await recordEvent(
                nextStatus.isFavorite ? "song_favorited" : "song_unfavorited",
                songId,
            );
        } catch (error) {
            // the favorite itself went through; only the activity tag misses it
            console.error("Recording a favorite change failed:", error);
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
    const x = useSWRImmutable<string[]>(key, () =>
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
    const x = useSWRImmutable<ArtistDetail>(key, () =>
        read(() => MusicKit.getArtist(artistId!)),
    );

    return {
        artist: x.data,
        artistLoading: x.isLoading || isInitializing,
        artistErr: x.error,
    };
}

/** Warm the same artist data, tint, and image caches the destination uses. */
export function useArtistPreview(artistId?: string) {
    const { artist } = useArtist(artistId);
    useArtworkTint(artist);
    const thumbnail = artist?.artworkUrlSmall;
    const hero = artist?.artworkUrl;
    useSWRImmutable(
        thumbnail || hero ? ["Artist.previewArtwork", thumbnail, hero] : null,
        async () => {
            const urls = [thumbnail, hero].filter((url): url is string =>
                Boolean(url),
            );
            return await Image.prefetch(urls, "memory-disk");
        },
    );
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

import type {
    ArtistDetail,
    CatalogSearchType,
    LibraryResult,
    LibrarySongOptions,
    MusicItem,
    MusicKitOptions,
    SearchResult,
    SongFavoriteStatus,
} from "./AppleMusicKit.types";

/** Apple caps `/v1/me/library/recently-added` at 25 items per page. */
const RECENTLY_ADDED_MAX_LIMIT = 25;

/** Apple Music catalog, library, and favorites operations. */
export const MusicKit = {
    /** Returns whether the native Apple Music bridge is installed. */
    isAvailable: (): boolean => native !== null,

    /** Retrieves full metadata for catalog or library song IDs in the requested order. */
    getSongInfo: async (ids: string[]): Promise<MusicItem[]> => {
        const nativeModule = requireNative();
        if (ids.length === 0) return [];
        const normalizedIds = ids.map((id) => requireIdentifier(id, "song ID"));
        return nativeModule.getSongInfo(normalizedIds);
    },

    /** Searches the Apple Music catalog for the requested resource types. */
    catalogSearch: async (
        query: string,
        types: CatalogSearchType[] = ["songs", "albums"],
        options?: MusicKitOptions,
    ): Promise<SearchResult> => {
        const normalizedQuery = query.trim();
        if (!normalizedQuery) {
            return {
                songs: [],
                albums: [],
                hasNextSongs: false,
                hasNextAlbums: false,
            };
        }
        const normalizedTypes = [...new Set(types)];
        const { limit, offset } = normalizeCatalogSearchOptions(options);
        return requireNative().catalogSearch(
            normalizedQuery,
            normalizedTypes,
            limit,
            offset,
        );
    },

    /** @deprecated Use `getLibrarySongs({ limit: 50 })`. */
    getTracksFromLibrary: async (): Promise<LibraryResult> => {
        return requireNative().getLibrarySongs({ limit: 50, offset: 0 });
    },

    /** Returns the user's library playlists, optionally limited by result count. */
    getUserPlaylists: async (
        options?: MusicKitOptions,
    ): Promise<LibraryResult> => {
        return normalizeLibraryResult(
            await requireNative().getUserPlaylists(normalizeOptions(options)),
        );
    },

    /** Returns the user's library songs, optionally limited by result count. */
    getLibrarySongs: async (
        options?: LibrarySongOptions,
    ): Promise<LibraryResult> => {
        return normalizeLibraryResult(
            await requireNative().getLibrarySongs(
                normalizeLibrarySongOptions(options),
            ),
        );
    },

    /** Returns the user's library albums, optionally limited by result count. */
    getLibraryAlbums: async (
        options?: MusicKitOptions,
    ): Promise<LibraryResult> => {
        return normalizeLibraryResult(
            await requireNative().getLibraryAlbums(normalizeOptions(options)),
        );
    },

    /**
     * Returns the user's recently added library items, newest first. Mixed on
     * purpose: albums, playlists, and songs that were added on their own, the
     * same grouping Apple Music shows. Apple caps this endpoint at 25 per page.
     */
    getRecentlyAdded: async (
        options?: MusicKitOptions,
    ): Promise<LibraryResult> => {
        const getRecentlyAdded = requireNativeMethod("getRecentlyAdded");
        return normalizeLibraryResult(
            await getRecentlyAdded(normalizeRecentlyAddedOptions(options)),
        );
    },

    /** Returns the tracks contained in a library album. */
    getAlbumSongs: async (
        albumId: string,
        options?: MusicKitOptions,
    ): Promise<LibraryResult> => {
        return normalizeLibraryResult(
            await requireNative().getAlbumSongs(
                requireIdentifier(albumId, "album ID"),
                normalizeOptions(options),
            ),
        );
    },

    /** Returns the tracks contained in a library playlist. */
    getPlaylistSongs: async (
        playlistId: string,
        options?: MusicKitOptions,
    ): Promise<LibraryResult> => {
        return normalizeLibraryResult(
            await requireNative().getPlaylistSongs(
                requireIdentifier(playlistId, "playlist ID"),
                normalizeOptions(options),
            ),
        );
    },

    /** Returns whether the user has favorited a catalog or library song. */
    getSongFavoriteStatus: async (id: string): Promise<SongFavoriteStatus> => {
        return requireNative().getSongFavoriteStatus(
            requireIdentifier(id, "song ID"),
        );
    },

    /** Adds or removes a song from the user's Apple Music favorites. */
    setSongFavoriteStatus: async (
        id: string,
        isFavorite: boolean,
    ): Promise<SongFavoriteStatus> => {
        return requireNative().setSongFavoriteStatus(
            requireIdentifier(id, "song ID"),
            isFavorite,
        );
    },

    /** Adds catalog songs to one of the user's library playlists. */
    addSongsToPlaylist: async (
        playlistId: string,
        ids: readonly string[],
    ): Promise<void> => {
        const normalizedIds = normalizeSongIds(ids);
        if (normalizedIds.length === 0) return;
        return requireNative().addSongsToPlaylist(
            requireIdentifier(playlistId, "playlist ID"),
            normalizedIds,
        );
    },

    /** Creates a library playlist, optionally seeded with catalog songs. */
    createPlaylist: async (
        name: string,
        ids: readonly string[] = [],
    ): Promise<MusicItem> => {
        const normalizedName = name.trim();
        if (!normalizedName) {
            throw new Error("Apple Music playlist name cannot be empty.");
        }
        return requireNative().createPlaylist(
            normalizedName,
            normalizeSongIds(ids),
        );
    },

    /**
     * Returns the catalog artist IDs credited on a song, most prominent first.
     * Empty for a library-only song, which has no catalog artist to point at.
     */
    getSongArtists: async (songId: string): Promise<string[]> => {
        return requireNative().getSongArtists(
            requireIdentifier(songId, "song ID"),
        );
    },

    /** Returns a catalog artist with their top songs and albums. */
    getArtist: async (artistId: string): Promise<ArtistDetail> => {
        return requireNative().getArtist(
            requireIdentifier(artistId, "artist ID"),
        );
    },
};

/** @internal Supplies the native catalog and library implementation. */
export function configureLibraryNative(
    nativeModule: LibraryNativeModule | null,
): void {
    native = nativeModule;
}

function normalizeLibraryResult(result: LibraryResult): LibraryResult {
    return {
        items: result.items,
        hasNextPage: result.hasNextPage === true,
        nextOffset: result.nextOffset,
    };
}

interface LibraryNativeModule {
    getSongInfo(ids: string[]): Promise<MusicItem[]>;
    catalogSearch(
        query: string,
        types: CatalogSearchType[],
        limit: number,
        offset: number,
    ): Promise<SearchResult>;
    getUserPlaylists(options: MusicKitOptions): Promise<LibraryResult>;
    getLibrarySongs(options: LibrarySongOptions): Promise<LibraryResult>;
    getPlaylistSongs(
        playlistId: string,
        options: MusicKitOptions,
    ): Promise<LibraryResult>;
    getLibraryAlbums(options: MusicKitOptions): Promise<LibraryResult>;
    getRecentlyAdded(options: MusicKitOptions): Promise<LibraryResult>;
    getAlbumSongs(
        albumId: string,
        options: MusicKitOptions,
    ): Promise<LibraryResult>;
    getSongFavoriteStatus(id: string): Promise<SongFavoriteStatus>;
    setSongFavoriteStatus(
        id: string,
        isFavorite: boolean,
    ): Promise<SongFavoriteStatus>;
    addSongsToPlaylist(
        playlistId: string,
        ids: readonly string[],
    ): Promise<void>;
    createPlaylist(name: string, ids: readonly string[]): Promise<MusicItem>;
    getSongArtists(songId: string): Promise<string[]>;
    getArtist(artistId: string): Promise<ArtistDetail>;
}

let native: LibraryNativeModule | null = null;

function requireNative(): LibraryNativeModule {
    if (!native) {
        throw new Error(
            "Apple Music requires a native development build; it is unavailable in Expo Go and on web.",
        );
    }
    return native;
}

/**
 * Resolves a native call that the installed binary may predate. The JS bundle
 * reloads on its own, the native module does not, so a method added after the
 * dev build was compiled is missing rather than broken.
 */
function requireNativeMethod<K extends keyof LibraryNativeModule>(
    name: K,
): LibraryNativeModule[K] {
    const nativeModule = requireNative();
    const method = nativeModule[name];
    if (typeof method !== "function") {
        throw new Error(
            `Apple Music ${String(name)} is missing from the installed native build. Rebuild the app (npx expo run:ios or run:android).`,
        );
    }
    return method.bind(nativeModule) as LibraryNativeModule[K];
}

function normalizeOptions(
    options?: MusicKitOptions,
): Required<MusicKitOptions> {
    const limit = Math.min(100, Math.max(1, Math.trunc(options?.limit ?? 50)));
    const offset = Math.max(0, Math.trunc(options?.offset ?? 0));
    return { limit, offset };
}

function normalizeCatalogSearchOptions(
    options?: MusicKitOptions,
): Required<MusicKitOptions> {
    const { limit, offset } = normalizeOptions(options);
    return { limit: Math.min(25, limit), offset };
}

function normalizeRecentlyAddedOptions(
    options?: MusicKitOptions,
): Required<MusicKitOptions> {
    const { limit, offset } = normalizeOptions(options);
    return { limit: Math.min(RECENTLY_ADDED_MAX_LIMIT, limit), offset };
}

function normalizeLibrarySongOptions(
    options?: LibrarySongOptions,
): LibrarySongOptions {
    const normalized = normalizeOptions(options);
    return options?.sort ? { ...normalized, sort: options.sort } : normalized;
}

function normalizeSongIds(ids: readonly string[]): string[] {
    return ids.map((id) => requireIdentifier(id, "song ID"));
}

function requireIdentifier(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`Apple Music ${label} cannot be empty.`);
    return normalized;
}

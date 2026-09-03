import type {
    CatalogSearchType,
    LibraryResult,
    LibrarySongOptions,
    MusicItem,
    MusicKitOptions,
    SearchResult,
    SongFavoriteStatus,
} from "./AppleMusicKit.types";

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
        return requireNative().catalogSearch(
            normalizedQuery,
            normalizedTypes,
            normalizeCatalogSearchOptions(options),
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
    };
}

interface LibraryNativeModule {
    getSongInfo(ids: string[]): Promise<MusicItem[]>;
    catalogSearch(
        query: string,
        types: CatalogSearchType[],
        options: MusicKitOptions,
    ): Promise<SearchResult>;
    getUserPlaylists(options: MusicKitOptions): Promise<LibraryResult>;
    getLibrarySongs(options: LibrarySongOptions): Promise<LibraryResult>;
    getPlaylistSongs(
        playlistId: string,
        options: MusicKitOptions,
    ): Promise<LibraryResult>;
    getSongFavoriteStatus(id: string): Promise<SongFavoriteStatus>;
    setSongFavoriteStatus(
        id: string,
        isFavorite: boolean,
    ): Promise<SongFavoriteStatus>;
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

function normalizeLibrarySongOptions(
    options?: LibrarySongOptions,
): LibrarySongOptions {
    const normalized = normalizeOptions(options);
    return options?.sort ? { ...normalized, sort: options.sort } : normalized;
}

function requireIdentifier(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`Apple Music ${label} cannot be empty.`);
    return normalized;
}

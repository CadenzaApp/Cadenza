/** Authorization states returned by Apple Music. */
export enum AuthStatus {
    /** The user granted Apple Music access. */
    Authorized = "authorized",
    /** The user denied Apple Music access. */
    Denied = "denied",
    /** Device or account restrictions prevent authorization. */
    Restricted = "restricted",
    /** The user has not yet responded to an authorization request. */
    NotDetermined = "notDetermined",
    /** The user dismissed the platform authorization flow. */
    Canceled = "canceled",
    /** The authorization flow failed before a status could be established. */
    Failed = "failed",
    /** The authorization state could not be determined. */
    Unknown = "unknown",
}

/** Result of requesting Apple Music authorization. */
export interface AuthResult {
    /** Current Apple Music authorization status. */
    status: AuthStatus;
    /** Music user token returned after successful authorization. */
    userToken?: string;
    /** Human-readable failure details, when authorization fails. */
    error?: string;
}

/** Apple Music resource types that can initialize a playback queue. */
export enum PlaybackQueueType {
    /** A catalog song. */
    Song = "song",
    /** A song from the user's library. */
    LibrarySong = "librarySong",
    /** A catalog album. */
    Album = "album",
    /** A catalog or library playlist. */
    Playlist = "playlist",
}

/** Resource categories returned by the module. */
export type MusicResourceKind = "song" | "album" | "playlist";

/** Whether an item originated in the Apple Music catalog or the user's library. */
export type MusicResourceSource = "catalog" | "library";

/** Catalog resource types supported by search. */
export type CatalogSearchType = "songs" | "albums";

/** Options shared by paginated Apple Music library requests. */
export interface MusicKitOptions {
    /** Maximum number of items to return. */
    limit?: number;
    /** Zero-based result offset. */
    offset?: number;
}

/** A server-side library-song order available through native iOS MusicKit. */
export interface LibrarySongSort {
    option: "dateAdded";
    direction: "ascending" | "descending";
}

/** Options for retrieving library songs. Android ignores `sort`. */
export interface LibrarySongOptions extends MusicKitOptions {
    sort?: LibrarySongSort;
}

/** Normalized metadata for an Apple Music song, album, or playlist. */
export interface MusicItem {
    /** Apple Music catalog or library identifier. */
    id: string;
    /** The kind of Apple Music resource represented by this item. */
    resourceKind: MusicResourceKind;
    /** Whether the resource was loaded from the catalog or the user's library. */
    source: MusicResourceSource;
    /** Apple Music catalog identifier, when one is available. */
    catalogId?: string;
    /** Apple Music library identifier, when one is available. */
    libraryId?: string;
    /** Display title for the item. */
    title: string;
    /** Display name of the primary artist. */
    artistName?: string;
    /** Artwork URL suitable for lists and compact controls. */
    artworkUrl?: string;
    /** High-resolution artwork for immersive playback surfaces. */
    artworkUrlLarge?: string;
    /** Resource type to use when creating a playback queue. */
    playbackType: PlaybackQueueType;
    /** Apple Music identifier of the containing album. */
    albumID?: string;
    /** Display name of the containing album. */
    albumName?: string;
    /** Song duration in seconds. */
    songDuration?: number;
    /** Release date represented as Unix epoch milliseconds. */
    releaseDate?: number;
    /** Date the song was added to the user's library, as Unix epoch milliseconds. */
    libraryAddedDate?: number;
    /** Genre names associated with the item. */
    genres?: string[];
    /** Canonical Apple Music URL suitable for sharing outside the app. */
    shareUrl?: string;
}

/** Current state of the shared Apple Music playback session. */
export interface PlaybackSnapshot {
    /** Whether audio is currently playing. */
    isPlaying: boolean;
    /** Whether a requested track is still loading. */
    isLoading: boolean;
    /** Current playback position in seconds. */
    progress: number;
    /** Current track duration in seconds. */
    duration?: number;
    /** Metadata for the active queue entry. */
    currentTrack?: MusicItem;
}

/** The user's favorite state for an Apple Music catalog song. */
export interface SongFavoriteStatus {
    /** Whether the song is currently in the user's favorites. */
    isFavorite: boolean;
}

/** Catalog search results grouped by Apple Music resource type. */
export interface SearchResult {
    /** Songs matching the search query. */
    songs: MusicItem[];
    /** Albums matching the search query. */
    albums: MusicItem[];
    /** Whether another page of matching songs is available. */
    hasNextSongs: boolean;
    /** Whether another page of matching albums is available. */
    hasNextAlbums: boolean;
}

/** A collection returned by an Apple Music library request. */
export interface LibraryResult {
    /** Normalized items returned by the request. */
    items: MusicItem[];
    /** Apple Music API path for the next page, when another page is available. */
    next?: string;
    /** Whether another page is available when the native request has no REST next path. */
    hasNextPage?: boolean;
}

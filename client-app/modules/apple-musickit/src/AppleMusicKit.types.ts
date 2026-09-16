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
export type CatalogSearchType = "songs" | "albums" | "artists";

/** Options shared by paginated Apple Music library requests. */
export interface MusicKitOptions {
    /** Maximum number of items to return. */
    limit?: number;
    /** Zero-based result offset. */
    offset?: number;
}

/** A server-side library-song order available through native iOS MusicKit. */
export interface LibrarySongSort {
    option: "title" | "artist" | "album" | "dateAdded";
    direction: "ascending" | "descending";
}

/** Options for retrieving library songs. Android ignores `sort`. */
export interface LibrarySongOptions extends MusicKitOptions {
    sort?: LibrarySongSort;
}

/** Normalized metadata for an Apple Music song, album, or playlist. */
export interface MusicItem {
    /** Stable identifier from the collection that produced this item. */
    id: string;
    /** The kind of Apple Music resource represented by this item. */
    resourceKind: MusicResourceKind;
    /** Whether the resource was loaded from the catalog or the user's library. */
    source: MusicResourceSource;
    /** Apple Music catalog identifier, when one is available. */
    catalogId?: string;
    /** Apple Music library identifier, when one is available. */
    libraryId?: string;
    /** Identifier sent to the native playback queue when it differs from `id`. */
    playbackId?: string;
    /** Display title for the item. */
    title: string;
    /** Display name of the primary artist. */
    artistName?: string;
    /** Apple Music catalog identifier of the primary artist. */
    artistId?: string;
    /** Artwork URL suitable for lists and compact controls. */
    artworkUrl?: string;
    /** High-resolution artwork for immersive playback surfaces. */
    artworkUrlLarge?: string;
    /**
     * Representative color of the artwork, as `#rrggbb`. Apple's own, when it
     * ships one. Library artwork often has none.
     */
    artworkColor?: string;
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

/** How the player picks the next entry in the queue. */
export enum ShuffleMode {
    /** Play the queue in order. */
    Off = "off",
    /** Play the queue in a random order. */
    Songs = "songs",
}

/** What the player does when it reaches the end of an entry or the queue. */
export enum RepeatMode {
    /** Stop at the end of the queue. */
    Off = "off",
    /** Repeat the current entry. */
    One = "one",
    /** Repeat the whole queue. */
    All = "all",
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
    /** How the player picks the next entry. Absent when native cannot report it. */
    shuffleMode?: ShuffleMode;
    /** What the player repeats. Absent when native cannot report it. */
    repeatMode?: RepeatMode;
}

/** The user's favorite state for an Apple Music resource. */
export interface FavoriteStatus {
    /** Whether the resource is currently in the user's favorites. */
    isFavorite: boolean;
}

/** The user's favorite state for an Apple Music catalog song. */
export type SongFavoriteStatus = FavoriteStatus;

/** The user's favorite state for an Apple Music album. */
export type AlbumFavoriteStatus = FavoriteStatus;

/** The user's favorite state for an Apple Music playlist. */
export type PlaylistFavoriteStatus = FavoriteStatus;

/** Which library collection kind a `MusicItem` or a favorite call refers to. */
export type CollectionFavoriteKind = "albums" | "playlists";

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
    /** Artists matching the search query. */
    artists: ArtistItem[];
    /** Whether another page of matching artists is available. */
    hasNextArtists: boolean;
    /** Offset supplied by Apple for the next songs page. */
    nextSongsOffset?: number;
}

/** A collection returned by an Apple Music library request. */
export interface LibraryResult {
    /** Normalized items returned by the request. */
    items: MusicItem[];
    /** Whether another page is available. Native modules normalize this value. */
    hasNextPage: boolean;
    /** Offset supplied by Apple for the next page. */
    nextOffset?: number;
}

/**
 * An Apple Music artist as it appears in a list. Deliberately not a `MusicItem`:
 * an artist is not queueable, so it has no `playbackType` and `MusicResourceKind`
 * stays free of an `"artist"` case.
 */
export interface ArtistItem {
    /** Canonical identifier. The catalog ID when one is known, the library ID otherwise. */
    id: string;
    /** Display name of the artist. */
    name: string;
    /** Artwork URL, when Apple has one. Library artists often do not. */
    artworkUrl?: string;
    /** Representative color of the artwork, as `#rrggbb`, when Apple ships one. */
    artworkColor?: string;
    /** Whether the artist came from the catalog or the user's library. */
    source: MusicResourceSource;
    /** Apple Music catalog identifier, when one is available. */
    catalogId?: string;
    /** Apple Music library identifier, when one is available. */
    libraryId?: string;
}

/** A page of artists returned by a library or search request. */
export interface ArtistResult {
    /** Normalized artists returned by the request. */
    items: ArtistItem[];
    /** Whether another page is available. Native modules normalize this value. */
    hasNextPage: boolean;
    /** Offset supplied by Apple for the next page. */
    nextOffset?: number;
}

/** An Apple Music catalog artist and the resources Apple returns alongside it. */
export interface ArtistDetail {
    /** Apple Music catalog identifier for the artist. */
    id: string;
    /** Display name of the artist. */
    name: string;
    /** Artwork URL suitable for an artist header, at hero resolution. */
    artworkUrl?: string;
    /**
     * The same artwork, small. Shown while the hero one downloads, so the page
     * is never a blank rectangle.
     */
    artworkUrlSmall?: string;
    /** Representative color of the artwork, as `#rrggbb`, when Apple ships one. */
    artworkColor?: string;
    /** Genre names Apple associates with the artist. */
    genres?: string[];
    /** The artist's most popular songs, in Apple's order. */
    topSongs: MusicItem[];
    /** The artist's albums, in Apple's order. */
    albums: MusicItem[];
    /** Canonical Apple Music URL for the artist. */
    shareUrl?: string;
}

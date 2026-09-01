export enum AuthStatus {
    Authorized = "authorized",
    Denied = "denied",
    Restricted = "restricted",
    NotDetermined = "notDetermined",
    Unknown = "unknown",
}

export interface AuthResult {
    status: AuthStatus;
    userToken?: string;
    error?: string;
}

export enum PlaybackQueueType {
    Song = "song",
    LibrarySong = "librarySong",
    Album = "album",
    Playlist = "playlist",
    Station = "station",
}

export interface MusicKitOptions {
    limit?: number;
}

export interface MusicItem {
    id: string;
    title: string;
    artistName?: string;
    artworkUrl?: string;
    /** High-resolution artwork for immersive playback surfaces. */
    artworkUrlLarge?: string;
    playbackType?: PlaybackQueueType;
    albumID?: string;
    albumName?: string;
    songDuration?: number;
    releaseDate?: number;
    genres?: string[];
    /** Canonical Apple Music URL suitable for sharing outside the app. */
    shareUrl?: string;
}

export interface PlaybackSnapshot {
    isPlaying: boolean;
    isLoading: boolean;
    progress: number;
    duration?: number;
    currentTrack?: MusicItem;
}

/** The user's favorite state for an Apple Music catalog song. */
export interface SongFavoriteStatus {
    isFavorite: boolean;
}

export interface SearchResult {
    songs?: MusicItem[];
    albums?: MusicItem[];
}

export interface LibraryResult {
    items: MusicItem[];
}

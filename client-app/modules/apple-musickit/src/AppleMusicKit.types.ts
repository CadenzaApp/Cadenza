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
    playbackType?: PlaybackQueueType;
}

export interface SearchResult {
    songs?: MusicItem[];
    albums?: MusicItem[];
}

export interface LibraryResult {
    items: MusicItem[];
}

export type AuthStatus =
  | 'authorized'
  | 'denied'
  | 'restricted'
  | 'notDetermined'
  | 'unknown';

export interface AuthResult {
  status: AuthStatus;
  userToken?: string;
  error?: string;
}

// --- NEW MUSICKIT TYPES ---

export type PlaybackQueueType = 'song' | 'album' | 'playlist' | 'station';

export interface MusicKitOptions {
  limit?: number;
}

export interface MusicItem {
  id: string;
  title: string;
  artistName?: string;
}

export interface SearchResult {
  songs?: MusicItem[];
  albums?: MusicItem[];
}

export interface LibraryResult {
  items: MusicItem[];
}

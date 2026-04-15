import { requireNativeModule, EventSubscription } from 'expo-modules-core';
import type {
  AuthResult,
  MusicKitOptions,
  PlaybackQueueType,
  SearchResult,
  LibraryResult
} from './AppleMusicKit.types';

interface AppleMusicKitNativeModule {
  authorize(developerToken: string): Promise<AuthResult>;
  play(): Promise<void>;
  pause(): Promise<void>;
  togglePlayerState(): Promise<void>;
  skipToNextEntry(): Promise<void>;
  skipToPreviousEntry(): Promise<void>;
  restartCurrentEntry(): Promise<void>;
  seekToTime(time: number): Promise<void>;

  // MusicKit Functionality
  catalogSearch(query: string, types: string[]): Promise<SearchResult>;
  getTracksFromLibrary(): Promise<LibraryResult>;
  getUserPlaylists(options?: MusicKitOptions): Promise<LibraryResult>;
  getLibrarySongs(options?: MusicKitOptions): Promise<LibraryResult>;
  getPlaylistSongs(playlistId: string): Promise<LibraryResult>;
  setPlaybackQueue(id: string, type: string): Promise<void>;

  addListener(eventName: string, listener: (...args: any[]) => void): EventSubscription;
  removeListeners(count: number): void;
}

const native = requireNativeModule<AppleMusicKitNativeModule>('AppleMusicKit');

export const Auth = {
  authorize: async (developerToken: string): Promise<AuthResult> => native.authorize(developerToken)
};

export const Player = {
  play: () => native.play(),
  pause: () => native.pause(),
  togglePlayerState: () => native.togglePlayerState(),
  skipToNextEntry: () => native.skipToNextEntry(),
  skipToPreviousEntry: () => native.skipToPreviousEntry(),
  restartCurrentEntry: () => native.restartCurrentEntry(),
  seekToTime: (time: number) => native.seekToTime(time),
  addListener: (
    eventName: 'onPlaybackStateChange',
    listener: (event: { state: string }) => void
  ): EventSubscription => {
    return native.addListener(eventName, listener);
  }
};

export const MusicKit = {
  catalogSearch: (query: string, types: string[] = ['songs', 'albums']): Promise<SearchResult> => {
    return native.catalogSearch(query, types);
  },
  getTracksFromLibrary: (): Promise<LibraryResult> => {
    return native.getTracksFromLibrary();
  },
  getUserPlaylists: (options?: MusicKitOptions): Promise<LibraryResult> => {
    return native.getUserPlaylists(options || {});
  },
  getLibrarySongs: (options?: MusicKitOptions): Promise<LibraryResult> => {
    return native.getLibrarySongs(options || {});
  },
  getPlaylistSongs: (playlistId: string): Promise<LibraryResult> => {
    return native.getPlaylistSongs(playlistId);
  },
  setPlaybackQueue: (id: string, type: PlaybackQueueType): Promise<void> => {
    return native.setPlaybackQueue(id, type);
  }
};

export * from './AppleMusicKit.types';

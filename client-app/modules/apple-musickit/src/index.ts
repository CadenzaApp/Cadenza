// TODO:  instead of hard-coding 200px song artwork requests,
//        expose a way for clients to request artwork at different sizes

import {
    requireOptionalNativeModule,
    EventSubscription,
} from "expo-modules-core";
import { useSyncExternalStore } from "react";
import {
    AuthStatus,
    type AuthResult,
    type MusicKitOptions,
    PlaybackQueueType,
    type SearchResult,
    type LibraryResult,
    MusicItem,
} from "./AppleMusicKit.types";

interface AppleMusicKitNativeModule {
    authorize(developerToken: string): Promise<AuthResult>;
    setTokens(developerToken: string, userToken: string | null): Promise<void>;
    play(): Promise<void>;
    pause(): Promise<void>;
    togglePlayerState(): Promise<boolean>;
    skipToNextEntry(): Promise<void>;
    skipToPreviousEntry(): Promise<void>;
    restartCurrentEntry(): Promise<void>;
    seekToTime(time: number): Promise<void>;

    // MusicKit Functionality
    getSongInfo(id: string): Promise<MusicItem>;
    catalogSearch(query: string, types: string[]): Promise<SearchResult>;
    getTracksFromLibrary(): Promise<LibraryResult>;
    getUserPlaylists(options?: MusicKitOptions): Promise<LibraryResult>;
    getLibrarySongs(options?: MusicKitOptions): Promise<LibraryResult>;
    getPlaylistSongs(playlistId: string): Promise<LibraryResult>;
    setPlaybackQueue(id: string, type: string): Promise<void>;

    addListener(
        eventName: string,
        listener: (...args: any[]) => void,
    ): EventSubscription;
    removeListeners(count: number): void;
}

const native =
    requireOptionalNativeModule<AppleMusicKitNativeModule>("AppleMusicKit");

let isPlaying = false;
const listeners = new Set<() => void>();

function notifyListeners() {
    listeners.forEach((listener) => listener());
}

// Listen to native OS changes. Things can happen that might start/stop playback
if (native) {
    native.addListener("onPlaybackStateChange", (event: { state: string }) => {
        const newState = event.state === "playing";
        if (isPlaying !== newState) {
            isPlaying = newState;
            notifyListeners();
        }
    });
}

/**
 * @returns a react hook for the isPlaying media playback state
 */
export function useIsPlaying() {
    return useSyncExternalStore(
        (callback) => {
            listeners.add(callback);
            return () => {
                listeners.delete(callback);
            };
        },
        () => isPlaying,
    );
}

export const Auth = {
    authorize: async (developerToken: string): Promise<AuthResult> => {
        if (!native) {
            console.warn("Apple Music API is not available in Expo Go.");
            return {
                status: AuthStatus.Unknown,
                error: "Apple Music API is not available in Expo Go. Test on an android emulator or physical device (physical device required for audio playback.)",
            };
        }
        return native.authorize(developerToken);
    },
    setTokens: async (
        developerToken: string,
        userToken?: string | null,
    ): Promise<void> => {
        if (!native) return;
        return native.setTokens(developerToken, userToken ?? null);
    },
};

export const Player = {
    /**
     * Plays playback for the currently queued track.
     */
    play: async () => {
        if (!native) return;
        await native.play();
        isPlaying = true;
        notifyListeners();
    },

    /**
     * Pauses playback for the currently queued track.
     */
    pause: async () => {
        if (!native) return;
        await native.pause();
        isPlaying = false;
        notifyListeners();
    },
    /**
     * Pauses playback if already playing and vice versa.
     *
     * @returns `true` if playback was switched to playing, `false` otherwise.
     */
    togglePlayerState: async (): Promise<boolean> => {
        if (!native) return false;
        await native.togglePlayerState();
        isPlaying = !isPlaying;
        notifyListeners();
        return isPlaying;
    },

    /**
     *
     * @returns `true` is the playback is playing, `false` otherwise.
     */
    isPlaying: (): boolean => isPlaying,

    /**
     * Ends the currently playing track and plays the next one in the queue.
     */
    skipToNextEntry: async () => {
        if (native) await native.skipToNextEntry();
    },

    /**
     * Ends the currently playing track and plays the previous one in the queue.
     */
    skipToPreviousEntry: async () => {
        if (native) await native.skipToPreviousEntry();
    },

    /**
     * Restarts the currently playing track from the beginning.
     */
    restartCurrentEntry: async () => {
        if (native) await native.restartCurrentEntry();
    },

    /**
     * Seeks to a specific time in the currently playing track.
     *
     * @param time The time to seek to, in seconds.
     */
    seekToTime: async (time: number) => {
        if (native) await native.seekToTime(time);
    },

    /**
     * Adds a listener for playback state changes.
     *
     * @param eventName The event name, always "onPlaybackStateChange".
     * @param listener The listener function to call when the playback state changes.
     * @returns An event subscription that can be used to remove the listener.
     */
    addListener: (
        eventName: "onPlaybackStateChange",
        listener: (event: { state: string }) => void,
    ): EventSubscription => {
        if (!native) {
            return { remove: () => {} } as EventSubscription;
        }
        return native.addListener(eventName, listener);
    },
};

export const MusicKit = {
    /**
     * Retrieves the full metadata for a specific song.
     * @param id The catalog ID or library ID of the song.
     * @returns A promise that resolves to the full MusicItem.
     */
    getSongInfo: async (id: string): Promise<MusicItem> => {
        if (!native)
            throw new Error("Apple Music API is not available in Expo Go.");

        // Infer the playback queue type based on Apple Music's ID formatting rules
        const inferredType = id.startsWith("i.")
            ? PlaybackQueueType.LibrarySong
            : PlaybackQueueType.Song;

        return native.getSongInfo(id, inferredType);
    },

    catalogSearch: async (
        query: string,
        types: string[] = ["songs", "albums"],
    ): Promise<SearchResult> => {
        if (!native) return { songs: [], albums: [] };
        return native.catalogSearch(query, types);
    },

    getTracksFromLibrary: async (): Promise<LibraryResult> => {
        if (!native) return { items: [] };
        return native.getTracksFromLibrary();
    },

    getUserPlaylists: async (
        options?: MusicKitOptions,
    ): Promise<LibraryResult> => {
        if (!native) return { items: [] };
        return native.getUserPlaylists(options || {});
    },

    getLibrarySongs: async (
        options?: MusicKitOptions,
    ): Promise<LibraryResult> => {
        if (!native) return { items: [] };
        return native.getLibrarySongs(options || {});
    },

    getPlaylistSongs: async (playlistId: string): Promise<LibraryResult> => {
        if (!native) return { items: [] };
        return native.getPlaylistSongs(playlistId);
    },

    setPlaybackQueue: async (
        id: string,
        type: PlaybackQueueType,
    ): Promise<void> => {
        if (!native) {
            console.warn("Playback is not supported in Expo Go.");
            return;
        }
        return native.setPlaybackQueue(id, type);
    },
};

export * from "./AppleMusicKit.types";

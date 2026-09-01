import { requireOptionalNativeModule } from "expo-modules-core";
import { useSyncExternalStore } from "react";
import {
    AuthStatus,
    type AuthResult,
    type MusicKitOptions,
    PlaybackQueueType,
    type SearchResult,
    type LibraryResult,
    MusicItem,
    PlaybackSnapshot,
    SongFavoriteStatus,
} from "./AppleMusicKit.types";

interface AppleMusicKitNativeModule {
    authorize(developerToken: string): Promise<AuthResult>;
    setTokens(developerToken: string, userToken: string | null): Promise<void>;
    play(): Promise<void>;
    pause(): Promise<void>;
    togglePlayerState(): Promise<void>;
    getPlaybackSnapshot(): Promise<PlaybackSnapshot>;
    skipToNextEntry(): Promise<void>;
    skipToPreviousEntry(): Promise<void>;
    restartCurrentEntry(): Promise<void>;
    seekToTime(time: number): Promise<void>;

    // MusicKit Functionality
    getSongInfo(ids: string[]): Promise<MusicItem[]>;
    catalogSearch(query: string, types: string[]): Promise<SearchResult>;
    getTracksFromLibrary(): Promise<LibraryResult>;
    getUserPlaylists(options?: MusicKitOptions): Promise<LibraryResult>;
    getLibrarySongs(options?: MusicKitOptions): Promise<LibraryResult>;
    getPlaylistSongs(playlistId: string): Promise<LibraryResult>;
    getSongFavoriteStatus(id: string): Promise<SongFavoriteStatus>;
    setSongFavoriteStatus(
        id: string,
        isFavorite: boolean,
    ): Promise<SongFavoriteStatus>;
    setPlaybackQueue(id: string, type: string): Promise<void>;
}

const native =
    requireOptionalNativeModule<AppleMusicKitNativeModule>("AppleMusicKit");

let playbackSnapshot: PlaybackSnapshot = {
    isPlaying: false,
    isLoading: false,
    progress: 0,
};
const listeners = new Set<() => void>();
const PLAYBACK_STATE_SETTLE_DELAY_MS = 400;
const PLAYBACK_LOAD_TIMEOUT_MS = 15_000;
let playbackStateRevision = 0;
let optimisticPlaybackUntil = 0;
let playbackLoadDeadline = 0;
let playbackCommandQueue = Promise.resolve();

function notifyListeners() {
    listeners.forEach((listener) => listener());
}

function updatePlaybackSnapshot(nextSnapshot: PlaybackSnapshot) {
    playbackSnapshot = nextSnapshot;
    notifyListeners();
}

function mergeCurrentTrack(
    nativeTrack: MusicItem | undefined,
    previousTrack: MusicItem | undefined,
) {
    if (!nativeTrack) return previousTrack;

    // Queue snapshots can omit artwork even when the search or library result
    // that started playback already supplied a usable image. Keep that known
    // artwork for the same track instead of replacing it with an empty value.
    const isSameTrack =
        previousTrack &&
        (!nativeTrack.id || nativeTrack.id === previousTrack.id);
    if (!isSameTrack) return nativeTrack;

    return {
        ...previousTrack,
        ...nativeTrack,
        artworkUrl: previousTrack.artworkUrl || nativeTrack.artworkUrl,
        artworkUrlLarge:
            previousTrack.artworkUrlLarge || nativeTrack.artworkUrlLarge,
    };
}

function setOptimisticPlaybackState(nextState: boolean) {
    playbackStateRevision += 1;
    optimisticPlaybackUntil = Date.now() + PLAYBACK_STATE_SETTLE_DELAY_MS;
    updatePlaybackSnapshot({
        ...playbackSnapshot,
        isPlaying: nextState,
    });
    return playbackStateRevision;
}

function beginPlaybackCommand() {
    playbackStateRevision += 1;
    optimisticPlaybackUntil = Date.now() + PLAYBACK_STATE_SETTLE_DELAY_MS;
    return playbackStateRevision;
}

function waitForPlaybackStateToSettle() {
    const remainingDelay = Math.max(0, optimisticPlaybackUntil - Date.now());
    return new Promise<void>((resolve) => {
        setTimeout(resolve, remainingDelay);
    });
}

function enqueuePlaybackCommand(command: () => Promise<void>) {
    const result = playbackCommandQueue.then(command, command);
    playbackCommandQueue = result.catch(() => undefined);
    return result;
}

export function usePlaybackSnapshot() {
    return useSyncExternalStore(
        (callback) => {
            listeners.add(callback);
            return () => {
                listeners.delete(callback);
            };
        },
        () => playbackSnapshot,
    );
}

export function useIsPlaying() {
    return usePlaybackSnapshot().isPlaying;
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
    refreshPlaybackSnapshot: async (
        ignoreSettleDelay = false,
        expectedRevision?: number,
    ): Promise<PlaybackSnapshot> => {
        if (!native) return playbackSnapshot;
        if (
            expectedRevision !== undefined &&
            expectedRevision !== playbackStateRevision
        ) {
            return playbackSnapshot;
        }
        if (!ignoreSettleDelay && Date.now() < optimisticPlaybackUntil) {
            return playbackSnapshot;
        }

        const requestRevision = playbackStateRevision;
        const nextSnapshot = await native.getPlaybackSnapshot();

        // Reads begun before a newer command must never overwrite that
        // command's optimistic state or its eventual native result.
        if (
            requestRevision !== playbackStateRevision ||
            (expectedRevision !== undefined &&
                expectedRevision !== playbackStateRevision)
        ) {
            return playbackSnapshot;
        }

        const resolvedSnapshot: PlaybackSnapshot = {
            ...nextSnapshot,
            isLoading:
                nextSnapshot.isLoading ||
                (playbackSnapshot.isLoading &&
                    !nextSnapshot.isPlaying &&
                    Date.now() < playbackLoadDeadline),
            currentTrack: mergeCurrentTrack(
                nextSnapshot.currentTrack,
                playbackSnapshot.currentTrack,
            ),
            duration:
                nextSnapshot.duration ??
                nextSnapshot.currentTrack?.songDuration ??
                playbackSnapshot.currentTrack?.songDuration,
        };
        if (resolvedSnapshot.isPlaying || !resolvedSnapshot.isLoading) {
            playbackLoadDeadline = 0;
        }
        updatePlaybackSnapshot(resolvedSnapshot);
        return resolvedSnapshot;
    },

    reconcilePlaybackSnapshot: async (
        commandRevision = playbackStateRevision,
    ): Promise<PlaybackSnapshot> => {
        await waitForPlaybackStateToSettle();
        if (commandRevision !== playbackStateRevision) {
            return playbackSnapshot;
        }
        return Player.refreshPlaybackSnapshot(true, commandRevision);
    },

    expectCurrentTrack: (track: MusicItem) => {
        playbackLoadDeadline = Date.now() + PLAYBACK_LOAD_TIMEOUT_MS;
        updatePlaybackSnapshot({
            ...playbackSnapshot,
            isPlaying: false,
            isLoading: true,
            currentTrack: track,
            duration: track.songDuration,
            progress: 0,
        });
    },

    /**
     * Plays playback for the currently queued track.
     */
    play: async () => {
        if (!native) return;
        // Reflect an intentional UI action immediately, then replace this
        // optimistic state with the native player's confirmed state below.
        const commandRevision = setOptimisticPlaybackState(true);
        try {
            await enqueuePlaybackCommand(() => native.play());
        } catch (error) {
            playbackLoadDeadline = 0;
            updatePlaybackSnapshot({
                ...playbackSnapshot,
                isPlaying: false,
                isLoading: false,
            });
            throw error;
        } finally {
            await Player.reconcilePlaybackSnapshot(commandRevision);
        }
    },

    /**
     * Pauses playback for the currently queued track.
     */
    pause: async () => {
        if (!native) return;
        playbackLoadDeadline = 0;
        // Reflect an intentional UI action immediately, then replace this
        // optimistic state with the native player's confirmed state below.
        const commandRevision = setOptimisticPlaybackState(false);
        updatePlaybackSnapshot({ ...playbackSnapshot, isLoading: false });
        try {
            await enqueuePlaybackCommand(() => native.pause());
        } finally {
            await Player.reconcilePlaybackSnapshot(commandRevision);
        }
    },
    /**
     * Pauses playback if already playing and vice versa.
     *
     * @returns `true` if playback was switched to playing, `false` otherwise.
     */
    togglePlayerState: async (): Promise<boolean> => {
        if (!native) return false;
        playbackLoadDeadline = 0;
        // The icon should respond to the tap without waiting for the native
        // bridge. A refresh afterwards is still authoritative, so external
        // playback changes or failed commands cannot leave it out of sync.
        const commandRevision = setOptimisticPlaybackState(
            !playbackSnapshot.isPlaying,
        );
        updatePlaybackSnapshot({ ...playbackSnapshot, isLoading: false });

        try {
            await enqueuePlaybackCommand(() => native.togglePlayerState());
        } catch (error) {
            await Player.reconcilePlaybackSnapshot(commandRevision);
            throw error;
        }

        return (await Player.reconcilePlaybackSnapshot(commandRevision))
            .isPlaying;
    },

    /**
     *
     * @returns `true` is the playback is playing, `false` otherwise.
     */
    isPlaying: (): boolean => playbackSnapshot.isPlaying,

    /**
     * Ends the currently playing track and plays the next one in the queue.
     */
    skipToNextEntry: async () => {
        if (!native) return;
        const commandRevision = beginPlaybackCommand();
        await enqueuePlaybackCommand(() => native.skipToNextEntry());
        await Player.reconcilePlaybackSnapshot(commandRevision);
    },

    /**
     * Ends the currently playing track and plays the previous one in the queue.
     */
    skipToPreviousEntry: async () => {
        if (!native) return;
        const commandRevision = beginPlaybackCommand();
        await enqueuePlaybackCommand(() => native.skipToPreviousEntry());
        await Player.reconcilePlaybackSnapshot(commandRevision);
    },

    /**
     * Restarts the currently playing track from the beginning.
     */
    restartCurrentEntry: async () => {
        if (!native) return;
        const commandRevision = beginPlaybackCommand();
        updatePlaybackSnapshot({ ...playbackSnapshot, progress: 0 });
        await enqueuePlaybackCommand(() => native.restartCurrentEntry());
        await Player.reconcilePlaybackSnapshot(commandRevision);
    },

    /**
     * Seeks to a specific time in the currently playing track.
     *
     * @param time The time to seek to, in seconds.
     */
    seekToTime: async (time: number) => {
        if (!native) return;
        const commandRevision = beginPlaybackCommand();
        updatePlaybackSnapshot({ ...playbackSnapshot, progress: time });
        await enqueuePlaybackCommand(() => native.seekToTime(time));
        await Player.reconcilePlaybackSnapshot(commandRevision);
    },
};

export const MusicKit = {
    /**
     * Retrieves the full metadata for one or more songs.
     * @param ids An array of catalog IDs or library IDs of the songs.
     * @returns A promise that resolves to an array of MusicItems in the requested order.
     */
    getSongInfo: async (ids: string[]): Promise<MusicItem[]> => {
        if (!native)
            throw new Error("Apple Music API is not available in Expo Go.");

        if (ids.length === 0) {
            return [];
        }

        return native.getSongInfo(ids);
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

    getSongFavoriteStatus: async (
        id: string,
    ): Promise<SongFavoriteStatus> => {
        if (!native) {
            throw new Error(
                "Apple Music favorites require a native development build.",
            );
        }
        return native.getSongFavoriteStatus(id);
    },

    setSongFavoriteStatus: async (
        id: string,
        isFavorite: boolean,
    ): Promise<SongFavoriteStatus> => {
        if (!native) {
            throw new Error(
                "Apple Music favorites require a native development build.",
            );
        }
        return native.setSongFavoriteStatus(id, isFavorite);
    },

    setPlaybackQueue: async (
        id: string,
        type: PlaybackQueueType,
    ): Promise<void> => {
        if (!native) {
            console.warn("Playback is not supported in Expo Go.");
            return;
        }
        return enqueuePlaybackCommand(() => native.setPlaybackQueue(id, type));
    },
};

export * from "./AppleMusicKit.types";

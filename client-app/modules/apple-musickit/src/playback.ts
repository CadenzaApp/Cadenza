import { useSyncExternalStore } from "react";

import {
    PlaybackQueueType,
    type MusicItem,
    type PlaybackSnapshot,
} from "./AppleMusicKit.types";

/** Supported playback operations available to package consumers. */
export interface PlaybackApi {
    /** Returns whether the native Apple Music bridge is installed. */
    isAvailable(): boolean;
    /** React hook that subscribes to the latest shared playback state. */
    usePlaybackSnapshot(): PlaybackSnapshot;
    /** React hook that subscribes to whether audio is currently playing. */
    useIsPlaying(): boolean;
    /** Fetches and publishes the latest native playback state. */
    refreshPlaybackSnapshot(): Promise<PlaybackSnapshot>;
    /** Loads a single Apple Music item and starts playing it. */
    playTrack(track: MusicItem, type?: PlaybackQueueType): Promise<void>;
    /** Replaces the native queue with the specified Apple Music item. */
    setPlaybackQueue(id: string, type: PlaybackQueueType): Promise<void>;
    /** Starts playback of the current queue entry. */
    play(): Promise<void>;
    /** Pauses playback of the current queue entry. */
    pause(): Promise<void>;
    /** Toggles playback and returns the reconciled playing state. */
    togglePlayerState(): Promise<boolean>;
    /** Returns the current playing state without subscribing. */
    isPlaying(): boolean;
    /** Skips to the next native queue entry. */
    skipToNextEntry(): Promise<void>;
    /** Skips to the previous native queue entry. */
    skipToPreviousEntry(): Promise<void>;
    /** Restarts the current queue entry. */
    restartCurrentEntry(): Promise<void>;
    /** Seeks the current queue entry to a time in seconds. */
    seekToTime(time: number): Promise<void>;
}

/** Commands and React hooks for the shared native Apple Music player. */
export const Playback: PlaybackApi = {
    isAvailable: () => native !== null,
    usePlaybackSnapshot: () => playbackImplementation.usePlaybackSnapshot(),
    useIsPlaying: () => playbackImplementation.useIsPlaying(),
    refreshPlaybackSnapshot: (): Promise<PlaybackSnapshot> => {
        if (!playbackRefreshPromise) {
            playbackRefreshPromise = playbackImplementation
                .refreshPlaybackSnapshot()
                .finally(() => {
                    playbackRefreshPromise = null;
                });
        }
        return playbackRefreshPromise;
    },
    playTrack: (track, type) =>
        playbackImplementation.playTrack(
            track,
            type ?? track.playbackType ?? PlaybackQueueType.Song,
        ),
    setPlaybackQueue: (id, type) =>
        playbackImplementation.setPlaybackQueue(id, type),
    play: () => playbackImplementation.play(),
    pause: () => playbackImplementation.pause(),
    togglePlayerState: () => playbackImplementation.togglePlayerState(),
    isPlaying: () => playbackImplementation.isPlaying(),
    skipToNextEntry: () => playbackImplementation.skipToNextEntry(),
    skipToPreviousEntry: () => playbackImplementation.skipToPreviousEntry(),
    restartCurrentEntry: () => playbackImplementation.restartCurrentEntry(),
    seekToTime: (time) => playbackImplementation.seekToTime(time),
};

/** @internal Supplies the native playback implementation. */
export function configurePlaybackNative(
    nativeModule: PlaybackNativeModule | null,
): void {
    playbackImplementation.configureNative(nativeModule);
}

interface PlaybackExpectation {
    revision: number;
    previousSnapshot: PlaybackSnapshot;
}

interface PlaybackNativeModule {
    play(): Promise<void>;
    pause(): Promise<void>;
    togglePlayerState(): Promise<void>;
    getPlaybackSnapshot(): Promise<PlaybackSnapshot>;
    skipToNextEntry(): Promise<void>;
    skipToPreviousEntry(): Promise<void>;
    restartCurrentEntry(): Promise<void>;
    seekToTime(time: number): Promise<void>;
    setPlaybackQueue(id: string, type: string): Promise<void>;
}

let native: PlaybackNativeModule | null = null;

const PLAYBACK_STATE_SETTLE_DELAY_MS = 400;
const PLAYBACK_LOAD_TIMEOUT_MS = 15_000;
let playbackSnapshot: PlaybackSnapshot = {
    isPlaying: false,
    isLoading: false,
    progress: 0,
};
let playbackStateRevision = 0;
let optimisticPlaybackUntil = 0;
let playbackLoadDeadline = 0;
let playbackCommandQueue = Promise.resolve();
let playbackRefreshPromise: Promise<PlaybackSnapshot> | null = null;
const listeners = new Set<() => void>();

interface PlaybackImplementationApi {
    /** @internal Supplies the native playback implementation. */
    configureNative(nativeModule: PlaybackNativeModule | null): void;
    /** @internal Returns the current in-memory playback snapshot. */
    getPlaybackSnapshot(): PlaybackSnapshot;
    /** @internal Subscribes to changes in the shared playback snapshot. */
    subscribeToPlaybackSnapshot(listener: () => void): () => void;
    /** @internal Publishes a new shared playback snapshot. */
    updatePlaybackSnapshot(nextSnapshot: PlaybackSnapshot): void;
    /** @internal Returns the revision of the latest playback command. */
    getPlaybackStateRevision(): number;
    /** @internal Returns when optimistic playback state may be reconciled. */
    getOptimisticPlaybackUntil(): number;
    /** @internal Publishes an optimistic playing state and returns its revision. */
    setOptimisticPlaybackState(nextState: boolean): number;
    /** @internal Starts a playback command revision. */
    beginPlaybackCommand(): number;
    /** @internal Publishes an optimistic track load and returns its rollback token. */
    beginExpectedTrack(track: MusicItem): PlaybackExpectation;
    /** @internal Rolls back a matching optimistic track load. */
    cancelExpectedTrack(
        trackId: string,
        expectation: PlaybackExpectation,
    ): PlaybackSnapshot;
    /** @internal Merges native state with optimistic track metadata. */
    resolvePlaybackSnapshot(nextSnapshot: PlaybackSnapshot): PlaybackSnapshot;
    /** @internal Clears the deadline for an expected track load. */
    clearPlaybackLoadDeadline(): void;
    /** Returns shared playback state and re-renders when it changes. */
    usePlaybackSnapshot(): PlaybackSnapshot;
    /** Returns whether the shared Apple Music player is currently playing. */
    useIsPlaying(): boolean;
    /** @internal Serializes a native command after earlier playback commands. */
    enqueuePlaybackCommand(command: () => Promise<void>): Promise<void>;
    /** @internal Waits until the optimistic playback window has elapsed. */
    waitForPlaybackStateToSettle(): Promise<void>;
    /** Fetches and publishes the latest native playback state. */
    refreshPlaybackSnapshot(
        ignoreSettleDelay?: boolean,
        expectedRevision?: number,
    ): Promise<PlaybackSnapshot>;
    /** Reconciles optimistic state with native state after a command settles. */
    reconcilePlaybackSnapshot(
        commandRevision?: number,
    ): Promise<PlaybackSnapshot>;
    /** Optimistically displays a track and returns its rollback token. */
    expectCurrentTrack(track: MusicItem): PlaybackExpectation;
    /** Restores state when the matching optimistic track load fails. */
    cancelExpectedCurrentTrack(
        trackId: string,
        expectation: PlaybackExpectation,
    ): PlaybackSnapshot;
    /** Replaces the native queue with the specified Apple Music item. */
    setPlaybackQueue(id: string, type: PlaybackQueueType): Promise<void>;
    /** Atomically loads and plays one Apple Music item. */
    playTrack(track: MusicItem, type: PlaybackQueueType): Promise<void>;
    /** Starts playback of the current queue entry. */
    play(): Promise<void>;
    /** Pauses playback of the current queue entry. */
    pause(): Promise<void>;
    /** Toggles playback and returns the reconciled playing state. */
    togglePlayerState(): Promise<boolean>;
    /** Returns the current playing state without subscribing. */
    isPlaying(): boolean;
    /** Skips to the next native queue entry. */
    skipToNextEntry(): Promise<void>;
    /** Skips to the previous native queue entry. */
    skipToPreviousEntry(): Promise<void>;
    /** Restarts the current queue entry. */
    restartCurrentEntry(): Promise<void>;
    /** Seeks the current queue entry to a time in seconds. */
    seekToTime(time: number): Promise<void>;
}

const playbackImplementation: PlaybackImplementationApi = {
    /** @internal Supplies the native playback implementation. */
    configureNative(nativeModule: PlaybackNativeModule | null): void {
        native = nativeModule;
    },

    /** @internal Returns the current in-memory playback snapshot. */
    getPlaybackSnapshot(): PlaybackSnapshot {
        return playbackSnapshot;
    },

    /** @internal Subscribes to changes in the shared playback snapshot. */
    subscribeToPlaybackSnapshot(listener: () => void): () => void {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },

    /** @internal Publishes a new shared playback snapshot. */
    updatePlaybackSnapshot(nextSnapshot: PlaybackSnapshot): void {
        playbackSnapshot = nextSnapshot;
        listeners.forEach((listener) => listener());
    },

    /** @internal Returns the revision of the latest playback command. */
    getPlaybackStateRevision(): number {
        return playbackStateRevision;
    },

    /** @internal Returns when optimistic playback state may be reconciled. */
    getOptimisticPlaybackUntil(): number {
        return optimisticPlaybackUntil;
    },

    /** @internal Publishes an optimistic playing state and returns its revision. */
    setOptimisticPlaybackState(nextState: boolean): number {
        playbackStateRevision += 1;
        optimisticPlaybackUntil = Date.now() + PLAYBACK_STATE_SETTLE_DELAY_MS;
        playbackImplementation.updatePlaybackSnapshot({
            ...playbackSnapshot,
            isPlaying: nextState,
        });
        return playbackStateRevision;
    },

    /** @internal Starts a playback command revision. */
    beginPlaybackCommand(): number {
        playbackStateRevision += 1;
        optimisticPlaybackUntil = Date.now() + PLAYBACK_STATE_SETTLE_DELAY_MS;
        return playbackStateRevision;
    },

    /** @internal Publishes an optimistic track load and returns its rollback token. */
    beginExpectedTrack(track: MusicItem): PlaybackExpectation {
        const previousSnapshot = playbackSnapshot;
        playbackStateRevision += 1;
        playbackLoadDeadline = Date.now() + PLAYBACK_LOAD_TIMEOUT_MS;
        optimisticPlaybackUntil = Date.now() + PLAYBACK_STATE_SETTLE_DELAY_MS;
        playbackImplementation.updatePlaybackSnapshot({
            ...playbackSnapshot,
            isPlaying: false,
            isLoading: true,
            currentTrack: track,
            duration: track.songDuration,
            progress: 0,
        });
        return { revision: playbackStateRevision, previousSnapshot };
    },

    /** @internal Rolls back a matching optimistic track load. */
    cancelExpectedTrack(
        trackId: string,
        expectation: PlaybackExpectation,
    ): PlaybackSnapshot {
        if (
            expectation.revision !== playbackStateRevision ||
            playbackSnapshot.currentTrack?.id !== trackId
        ) {
            return playbackSnapshot;
        }

        playbackStateRevision += 1;
        playbackLoadDeadline = 0;
        optimisticPlaybackUntil = 0;
        playbackImplementation.updatePlaybackSnapshot(
            expectation.previousSnapshot,
        );
        return playbackSnapshot;
    },

    /** @internal Merges authoritative native state with optimistic track metadata. */
    resolvePlaybackSnapshot(nextSnapshot: PlaybackSnapshot): PlaybackSnapshot {
        const nativeTrack = nextSnapshot.currentTrack;
        const previousTrack = playbackSnapshot.currentTrack;
        const isSameTrack =
            previousTrack &&
            nativeTrack &&
            (!nativeTrack.id || nativeTrack.id === previousTrack.id);
        const currentTrack = !nativeTrack
            ? previousTrack
            : isSameTrack
              ? {
                    ...previousTrack,
                    ...nativeTrack,
                    artworkUrl:
                        previousTrack.artworkUrl || nativeTrack.artworkUrl,
                    artworkUrlLarge:
                        previousTrack.artworkUrlLarge ||
                        nativeTrack.artworkUrlLarge,
                }
              : nativeTrack;
        const resolvedSnapshot: PlaybackSnapshot = {
            ...nextSnapshot,
            isLoading:
                nextSnapshot.isLoading ||
                (playbackSnapshot.isLoading &&
                    !nextSnapshot.isPlaying &&
                    Date.now() < playbackLoadDeadline),
            currentTrack,
            duration:
                nextSnapshot.duration ??
                nextSnapshot.currentTrack?.songDuration ??
                previousTrack?.songDuration,
        };
        if (resolvedSnapshot.isPlaying || !resolvedSnapshot.isLoading) {
            playbackLoadDeadline = 0;
        }
        return resolvedSnapshot;
    },

    /** @internal Clears the deadline for an expected track load. */
    clearPlaybackLoadDeadline(): void {
        playbackLoadDeadline = 0;
    },

    /** Returns the latest shared native playback state and re-renders on changes. */
    usePlaybackSnapshot(): PlaybackSnapshot {
        return useSyncExternalStore(
            playbackImplementation.subscribeToPlaybackSnapshot,
            playbackImplementation.getPlaybackSnapshot,
            playbackImplementation.getPlaybackSnapshot,
        );
    },

    /** Returns whether the shared Apple Music player is currently playing. */
    useIsPlaying(): boolean {
        return playbackImplementation.usePlaybackSnapshot().isPlaying;
    },

    /** @internal Serializes a native playback command after earlier commands. */
    enqueuePlaybackCommand(command: () => Promise<void>): Promise<void> {
        const result = playbackCommandQueue.then(command, command);
        playbackCommandQueue = result.catch(() => undefined);
        return result;
    },

    /** @internal Waits until the optimistic playback window has elapsed. */
    waitForPlaybackStateToSettle(): Promise<void> {
        const remainingDelay = Math.max(
            0,
            playbackImplementation.getOptimisticPlaybackUntil() - Date.now(),
        );
        return new Promise<void>((resolve) =>
            setTimeout(resolve, remainingDelay),
        );
    },

    /** Fetches and publishes the native player state unless a newer command supersedes it. */
    refreshPlaybackSnapshot: async (
        ignoreSettleDelay = false,
        expectedRevision?: number,
    ): Promise<PlaybackSnapshot> => {
        if (!native) return playbackImplementation.getPlaybackSnapshot();
        if (
            expectedRevision !== undefined &&
            expectedRevision !==
                playbackImplementation.getPlaybackStateRevision()
        ) {
            return playbackImplementation.getPlaybackSnapshot();
        }
        if (
            !ignoreSettleDelay &&
            Date.now() < playbackImplementation.getOptimisticPlaybackUntil()
        ) {
            return playbackImplementation.getPlaybackSnapshot();
        }

        const requestRevision =
            playbackImplementation.getPlaybackStateRevision();
        const nextSnapshot = await native.getPlaybackSnapshot();
        if (
            requestRevision !==
                playbackImplementation.getPlaybackStateRevision() ||
            (expectedRevision !== undefined &&
                expectedRevision !==
                    playbackImplementation.getPlaybackStateRevision())
        ) {
            return playbackImplementation.getPlaybackSnapshot();
        }

        const resolvedSnapshot =
            playbackImplementation.resolvePlaybackSnapshot(nextSnapshot);
        playbackImplementation.updatePlaybackSnapshot(resolvedSnapshot);
        return resolvedSnapshot;
    },

    /** Waits for an optimistic command to settle, then refreshes authoritative playback state. */
    reconcilePlaybackSnapshot: async (
        commandRevision = playbackImplementation.getPlaybackStateRevision(),
    ): Promise<PlaybackSnapshot> => {
        await playbackImplementation.waitForPlaybackStateToSettle();
        if (
            commandRevision !==
            playbackImplementation.getPlaybackStateRevision()
        ) {
            return playbackImplementation.getPlaybackSnapshot();
        }
        return playbackImplementation.refreshPlaybackSnapshot(
            true,
            commandRevision,
        );
    },

    /** Optimistically displays a track as loading and returns a token for possible rollback. */
    expectCurrentTrack: (track: MusicItem): PlaybackExpectation =>
        playbackImplementation.beginExpectedTrack(track),

    /** Restores the prior snapshot when the matching optimistic track load fails. */
    cancelExpectedCurrentTrack: (
        trackId: string,
        expectation: PlaybackExpectation,
    ): PlaybackSnapshot =>
        playbackImplementation.cancelExpectedTrack(trackId, expectation),

    /** Replaces the native playback queue with the specified Apple Music item. */
    setPlaybackQueue: async (
        id: string,
        type: PlaybackQueueType,
    ): Promise<void> => {
        const nativeModule = requirePlaybackNative();
        const normalizedId = requirePlaybackIdentifier(id);
        const commandRevision = playbackImplementation.beginPlaybackCommand();
        await playbackImplementation.enqueuePlaybackCommand(() =>
            nativeModule.setPlaybackQueue(normalizedId, type),
        );
        await playbackImplementation.reconcilePlaybackSnapshot(commandRevision);
    },

    /** Atomically loads and plays one Apple Music item. */
    playTrack: async (
        track: MusicItem,
        type: PlaybackQueueType,
    ): Promise<void> => {
        const nativeModule = requirePlaybackNative();
        requirePlaybackIdentifier(track.id);

        const expectation = playbackImplementation.beginExpectedTrack(track);
        playbackImplementation.updatePlaybackSnapshot({
            ...playbackImplementation.getPlaybackSnapshot(),
            isPlaying: true,
        });

        try {
            await playbackImplementation.enqueuePlaybackCommand(async () => {
                await nativeModule.setPlaybackQueue(track.id, type);
                await nativeModule.play();
            });
            await playbackImplementation.reconcilePlaybackSnapshot(
                expectation.revision,
            );
        } catch (error) {
            playbackImplementation.cancelExpectedCurrentTrack(
                track.id,
                expectation,
            );
            throw error;
        }
    },

    /** Starts playback of the current native queue entry. */
    play: async (): Promise<void> => {
        const nativeModule = requirePlaybackNative();
        const commandRevision =
            playbackImplementation.setOptimisticPlaybackState(true);
        try {
            await playbackImplementation.enqueuePlaybackCommand(() =>
                nativeModule.play(),
            );
        } catch (error) {
            playbackImplementation.clearPlaybackLoadDeadline();
            playbackImplementation.updatePlaybackSnapshot({
                ...playbackImplementation.getPlaybackSnapshot(),
                isPlaying: false,
                isLoading: false,
            });
            throw error;
        } finally {
            await playbackImplementation.reconcilePlaybackSnapshot(
                commandRevision,
            );
        }
    },

    /** Pauses playback of the current native queue entry. */
    pause: async (): Promise<void> => {
        const nativeModule = requirePlaybackNative();
        playbackImplementation.clearPlaybackLoadDeadline();
        const commandRevision =
            playbackImplementation.setOptimisticPlaybackState(false);
        playbackImplementation.updatePlaybackSnapshot({
            ...playbackImplementation.getPlaybackSnapshot(),
            isLoading: false,
        });
        try {
            await playbackImplementation.enqueuePlaybackCommand(() =>
                nativeModule.pause(),
            );
        } finally {
            await playbackImplementation.reconcilePlaybackSnapshot(
                commandRevision,
            );
        }
    },

    /** Toggles the current entry and resolves with its reconciled playing state. */
    togglePlayerState: async (): Promise<boolean> => {
        const nativeModule = requirePlaybackNative();
        playbackImplementation.clearPlaybackLoadDeadline();
        const commandRevision =
            playbackImplementation.setOptimisticPlaybackState(
                !playbackImplementation.getPlaybackSnapshot().isPlaying,
            );
        playbackImplementation.updatePlaybackSnapshot({
            ...playbackImplementation.getPlaybackSnapshot(),
            isLoading: false,
        });
        try {
            await playbackImplementation.enqueuePlaybackCommand(() =>
                nativeModule.togglePlayerState(),
            );
        } catch (error) {
            await playbackImplementation.reconcilePlaybackSnapshot(
                commandRevision,
            );
            throw error;
        }
        return (
            await playbackImplementation.reconcilePlaybackSnapshot(
                commandRevision,
            )
        ).isPlaying;
    },

    /** Returns the most recently published playback state without subscribing. */
    isPlaying: (): boolean =>
        playbackImplementation.getPlaybackSnapshot().isPlaying,

    /** Skips to the next entry in the native playback queue. */
    skipToNextEntry: async (): Promise<void> => {
        const nativeModule = requirePlaybackNative();
        const commandRevision = playbackImplementation.beginPlaybackCommand();
        await playbackImplementation.enqueuePlaybackCommand(() =>
            nativeModule.skipToNextEntry(),
        );
        await playbackImplementation.reconcilePlaybackSnapshot(commandRevision);
    },

    /** Skips to the previous entry in the native playback queue. */
    skipToPreviousEntry: async (): Promise<void> => {
        const nativeModule = requirePlaybackNative();
        const commandRevision = playbackImplementation.beginPlaybackCommand();
        await playbackImplementation.enqueuePlaybackCommand(() =>
            nativeModule.skipToPreviousEntry(),
        );
        await playbackImplementation.reconcilePlaybackSnapshot(commandRevision);
    },

    /** Restarts the current queue entry from the beginning. */
    restartCurrentEntry: async (): Promise<void> => {
        const nativeModule = requirePlaybackNative();
        const commandRevision = playbackImplementation.beginPlaybackCommand();
        playbackImplementation.updatePlaybackSnapshot({
            ...playbackImplementation.getPlaybackSnapshot(),
            progress: 0,
        });
        await playbackImplementation.enqueuePlaybackCommand(() =>
            nativeModule.restartCurrentEntry(),
        );
        await playbackImplementation.reconcilePlaybackSnapshot(commandRevision);
    },

    /** Seeks the current queue entry to a time in seconds. */
    seekToTime: async (time: number): Promise<void> => {
        const nativeModule = requirePlaybackNative();
        if (!Number.isFinite(time)) {
            throw new Error("Apple Music seek time must be a finite number.");
        }
        const boundedTime = Math.max(0, time);
        const commandRevision = playbackImplementation.beginPlaybackCommand();
        playbackImplementation.updatePlaybackSnapshot({
            ...playbackImplementation.getPlaybackSnapshot(),
            progress: boundedTime,
        });
        await playbackImplementation.enqueuePlaybackCommand(() =>
            nativeModule.seekToTime(boundedTime),
        );
        await playbackImplementation.reconcilePlaybackSnapshot(commandRevision);
    },
};

function requirePlaybackNative(): PlaybackNativeModule {
    if (!native) {
        throw new Error(
            "Apple Music playback requires a native development build; it is unavailable in Expo Go and on web.",
        );
    }
    return native;
}

function requirePlaybackIdentifier(id: string): string {
    const normalized = id.trim();
    if (!normalized) throw new Error("Apple Music playback ID cannot be empty.");
    return normalized;
}

import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    ReactNode,
} from "react";
import { Alert, AppState } from "react-native";
import { MusicItem, Playback, RepeatMode, ShuffleMode } from "@apple-musickit";

import { useAppleMusic } from "./apple-music-auth";
import {
    insertQueueEntriesNext,
    jumpToQueueEntry,
    moveQueueEntry,
    nearestQueuePosition,
    removeQueueEntry,
    type QueueState,
} from "./queue-order";
import { samePlayableItem } from "./playable-item";

export type PlaybackQueue = {
    tracks: MusicItem[];
    startIndex?: number;
};

type PlaybackInfo = {
    activeTrackId: string | null;
    activeTrack: MusicItem | null;
    isPlaying: boolean;
    isLoading: boolean;
    progress: number;
    queue: MusicItem[];
    queueIndex: number;
    /** Everything queued after the entry that is playing, in order. */
    upcoming: MusicItem[];
    shuffleMode: ShuffleMode;
    repeatMode: RepeatMode;
    canSkipToNext: boolean;
    canSkipToPrevious: boolean;
    playQueue: (queue: PlaybackQueue) => Promise<void>;
    addToQueue: (tracks: readonly MusicItem[]) => Promise<void>;
    playNext: (tracks: readonly MusicItem[]) => Promise<void>;
    /** Positions address the whole queue, not the upcoming slice. */
    moveQueueItem: (fromIndex: number, toIndex: number) => Promise<void>;
    removeQueueItem: (index: number) => Promise<void>;
    playQueueItem: (index: number) => Promise<void>;
    setShuffleMode: (mode: ShuffleMode) => Promise<void>;
    setRepeatMode: (mode: RepeatMode) => Promise<void>;
    togglePlayback: (track: MusicItem) => Promise<void>;
    seekTo: (time: number) => Promise<void>;
    skipToNext: () => Promise<void>;
    skipToPrevious: () => Promise<void>;
};

const PlaybackContext = createContext<PlaybackInfo | null>(null);
export type PlaybackTrackState = Pick<
    PlaybackInfo,
    | "activeTrackId"
    | "activeTrack"
    | "isPlaying"
    | "isLoading"
    | "canSkipToNext"
    | "canSkipToPrevious"
>;
const PlaybackTrackStateContext = createContext<PlaybackTrackState | null>(
    null,
);
type PlaybackCommands = Pick<
    PlaybackInfo,
    | "playQueue"
    | "addToQueue"
    | "playNext"
    | "moveQueueItem"
    | "removeQueueItem"
    | "playQueueItem"
    | "setShuffleMode"
    | "setRepeatMode"
    | "togglePlayback"
    | "seekTo"
    | "skipToNext"
    | "skipToPrevious"
>;
const PlaybackCommandsContext = createContext<PlaybackCommands | null>(null);

export function usePlayback() {
    return useContext(PlaybackContext)!;
}

/** Track and transport state without subscribing to progress-only updates. */
export function usePlaybackTrackState() {
    const value = useContext(PlaybackTrackStateContext);
    if (!value) {
        throw new Error(
            "usePlaybackTrackState must run inside PlaybackProvider",
        );
    }
    return value;
}

/** Playback commands whose identity is stable across progress updates. */
export function usePlaybackCommands() {
    return useContext(PlaybackCommandsContext)!;
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
    const { isConnected, ensureConnected } = useAppleMusic();
    const snapshot = Playback.usePlaybackSnapshot();
    const [queue, setQueue] = useState<MusicItem[]>([]);
    const [queueIndex, setQueueIndex] = useState(-1);
    const commandImplementationsRef = useRef<PlaybackCommands | null>(null);
    const snapshotTrack = snapshot.currentTrack ?? null;
    // Search outward from the index we already believe in. A queue holding the
    // same song twice would otherwise always resolve to the first copy, and the
    // index would stop tracking playback as soon as the second copy played.
    const nativeQueueIndex = snapshotTrack
        ? nearestQueuePosition(queue, queueIndex, (track) =>
              samePlayableItem(track, snapshotTrack),
          )
        : -1;
    const resolvedQueueIndex =
        nativeQueueIndex >= 0 ? nativeQueueIndex : queueIndex;
    const queuedTrack = queue[resolvedQueueIndex];
    const activeTrack =
        queuedTrack &&
        snapshotTrack &&
        samePlayableItem(queuedTrack, snapshotTrack)
            ? queuedTrack
            : snapshotTrack;
    const activeTrackId = activeTrack?.id ?? null;

    useEffect(() => {
        let active = true;

        const refreshPlaybackSnapshot = () => {
            if (!active || AppState.currentState !== "active") return;

            void Playback.refreshPlaybackSnapshot().catch((error) => {
                console.warn("Failed to refresh playback snapshot:", error);
            });
        };

        refreshPlaybackSnapshot();
        const interval = setInterval(refreshPlaybackSnapshot, 750);
        const appStateSubscription = AppState.addEventListener(
            "change",
            (nextAppState) => {
                if (nextAppState === "active") refreshPlaybackSnapshot();
            },
        );

        return () => {
            active = false;
            clearInterval(interval);
            appStateSubscription.remove();
        };
    }, []);

    function requireConnected(action: string) {
        if (isConnected) return true;
        Alert.alert(
            "Apple Music Not Connected",
            `Open Account from the profile button and connect Apple Music ${action}.`,
        );
        return false;
    }

    /** Starts a queue and throws on failure. Callers own the user-facing alert. */
    async function startQueue({ tracks, startIndex = 0 }: PlaybackQueue) {
        const playableTracks = tracks.filter((track) =>
            Boolean(track.playbackId ?? track.id),
        );
        if (playableTracks.length === 0) return;

        await ensureConnected();
        const boundedIndex = Math.max(
            0,
            Math.min(startIndex, playableTracks.length - 1),
        );
        const previousQueue = queue;
        const previousQueueIndex = queueIndex;
        setQueue(playableTracks);
        setQueueIndex(boundedIndex);
        try {
            await Playback.playSongQueue(playableTracks, boundedIndex);
        } catch (error) {
            setQueue(previousQueue);
            setQueueIndex(previousQueueIndex);
            throw error;
        }
    }

    async function playQueue(nextQueue: PlaybackQueue) {
        if (!requireConnected("before playing songs")) return;

        try {
            await startQueue(nextQueue);
        } catch (e) {
            console.error("Failed to start playback queue:", e);
            Alert.alert("Playback Error", "Failed to start playback.");
            throw e;
        }
    }

    async function togglePlayback(track: MusicItem) {
        const trackId = track.id;
        const isNewTrack = activeTrackId !== trackId;

        if (!trackId) return;

        try {
            if (!isNewTrack) {
                await Playback.togglePlayerState();
            } else {
                // Song lookup/list playback intentionally creates a one-song
                // queue today. Playlist and shuffle surfaces can pass a larger
                // track array through playQueue without changing this provider.
                await playQueue({ tracks: [track] });
            }
        } catch (e) {
            console.error("Failed to toggle playback:", e);
            // playQueue already alerted on the new-track path.
            if (!isNewTrack) {
                Alert.alert(
                    "Playback Error",
                    "Failed to update playback state.",
                );
            }
        }
    }

    async function addToQueue(tracks: readonly MusicItem[]) {
        const playableTracks = tracks.filter((track) =>
            Boolean(track.playbackId ?? track.id),
        );
        if (playableTracks.length === 0) return;

        if (!requireConnected("before adding songs to the queue")) {
            throw new Error("Apple Music is not connected.");
        }

        try {
            await ensureConnected();

            // Nothing is playing, so there is no queue to append to.
            if (queue.length === 0 && !activeTrack) {
                await startQueue({ tracks: playableTracks });
                return;
            }

            await Playback.appendSongQueue(playableTracks);
            setQueue((currentQueue) => {
                // Keep whatever we already mirror. Falling back to just the
                // active track would strand the tracks still queued natively,
                // and skipToNext is bounded by this list.
                const base =
                    currentQueue.length > 0
                        ? currentQueue
                        : activeTrack
                          ? [activeTrack]
                          : [];
                return [...base, ...playableTracks];
            });
            if (queueIndex < 0 && activeTrack) setQueueIndex(0);
        } catch (e) {
            console.error("Failed to add tracks to playback queue:", e);
            Alert.alert("Playback Error", "Failed to add songs to the queue.");
            throw e;
        }
    }

    /**
     * Applies a mutation to the mirror and to the native queue together. The
     * mirror moves first so the list does not lag the drag, and rolls back if
     * native refuses, because a mirror that disagrees with native sends every
     * later index-addressed command to the wrong entry.
     */
    async function mutateQueue(
        describe: string,
        project: (state: QueueState<MusicItem>) => QueueState<MusicItem>,
        apply: () => Promise<void>,
    ) {
        const current: QueueState<MusicItem> = {
            items: queue,
            index: resolvedQueueIndex,
        };
        const next = project(current);
        if (next === current) return;

        setQueue(next.items);
        setQueueIndex(next.index);
        try {
            await apply();
        } catch (e) {
            console.error(`Failed to ${describe}:`, e);
            setQueue(current.items);
            setQueueIndex(current.index);
            Alert.alert("Playback Error", `Failed to ${describe}.`);
            throw e;
        }
    }

    async function playNext(tracks: readonly MusicItem[]) {
        const playableTracks = tracks.filter((track) =>
            Boolean(track.playbackId ?? track.id),
        );
        if (playableTracks.length === 0) return;

        if (!requireConnected("before queueing songs")) {
            throw new Error("Apple Music is not connected.");
        }
        await ensureConnected();

        // Nothing is playing, so there is no current entry to queue after.
        if (queue.length === 0 && !activeTrack) {
            await playQueue({ tracks: playableTracks });
            return;
        }

        await mutateQueue(
            "queue those songs next",
            (state) => insertQueueEntriesNext(state, playableTracks),
            () => Playback.insertSongsNext(playableTracks),
        );
    }

    async function moveQueueItem(fromIndex: number, toIndex: number) {
        await mutateQueue(
            "reorder the queue",
            (state) => moveQueueEntry(state, fromIndex, toIndex),
            () => Playback.moveQueueItem(fromIndex, toIndex),
        );
    }

    async function removeQueueItem(index: number) {
        await mutateQueue(
            "remove that song from the queue",
            (state) => removeQueueEntry(state, index),
            () => Playback.removeQueueItem(index),
        );
    }

    async function playQueueItem(index: number) {
        await mutateQueue(
            "play that song",
            (state) => jumpToQueueEntry(state, index),
            () => Playback.playQueueItem(index),
        );
    }

    async function setShuffleMode(mode: ShuffleMode) {
        try {
            await Playback.setShuffleMode(mode);
        } catch (e) {
            console.error("Failed to set the shuffle mode:", e);
        }
    }

    async function setRepeatMode(mode: RepeatMode) {
        try {
            await Playback.setRepeatMode(mode);
        } catch (e) {
            console.error("Failed to set the repeat mode:", e);
        }
    }

    async function seekTo(time: number) {
        const boundedTime = Math.max(
            0,
            Math.min(time, activeTrack?.songDuration ?? time),
        );
        try {
            await Playback.seekToTime(boundedTime);
        } catch (e) {
            console.error("Failed to seek playback:", e);
        }
    }

    async function skipToNext() {
        const nextIndex = resolvedQueueIndex + 1;
        if (nextIndex >= queue.length) return;

        try {
            await Playback.skipToNextEntry();
            setQueueIndex(nextIndex);
        } catch (e) {
            console.error("Failed to skip to the next track:", e);
        }
    }

    async function skipToPrevious() {
        const previousIndex = resolvedQueueIndex - 1;
        if (previousIndex < 0) return;

        try {
            await Playback.skipToPreviousEntry();
            setQueueIndex(previousIndex);
        } catch (e) {
            console.error("Failed to skip to the previous track:", e);
        }
    }

    useEffect(() => {
        commandImplementationsRef.current = {
            playQueue,
            addToQueue,
            playNext,
            moveQueueItem,
            removeQueueItem,
            playQueueItem,
            setShuffleMode,
            setRepeatMode,
            togglePlayback,
            seekTo,
            skipToNext,
            skipToPrevious,
        };
    });
    const commands = useMemo<PlaybackCommands>(
        () => ({
            playQueue: (nextQueue) =>
                commandImplementationsRef.current!.playQueue(nextQueue),
            addToQueue: (tracks) =>
                commandImplementationsRef.current!.addToQueue(tracks),
            playNext: (tracks) =>
                commandImplementationsRef.current!.playNext(tracks),
            moveQueueItem: (fromIndex, toIndex) =>
                commandImplementationsRef.current!.moveQueueItem(
                    fromIndex,
                    toIndex,
                ),
            removeQueueItem: (index) =>
                commandImplementationsRef.current!.removeQueueItem(index),
            playQueueItem: (index) =>
                commandImplementationsRef.current!.playQueueItem(index),
            setShuffleMode: (mode) =>
                commandImplementationsRef.current!.setShuffleMode(mode),
            setRepeatMode: (mode) =>
                commandImplementationsRef.current!.setRepeatMode(mode),
            togglePlayback: (track) =>
                commandImplementationsRef.current!.togglePlayback(track),
            seekTo: (time) => commandImplementationsRef.current!.seekTo(time),
            skipToNext: () => commandImplementationsRef.current!.skipToNext(),
            skipToPrevious: () =>
                commandImplementationsRef.current!.skipToPrevious(),
        }),
        [],
    );
    const trackState = useMemo<PlaybackTrackState>(
        () => ({
            activeTrackId,
            activeTrack,
            isPlaying: snapshot.isPlaying,
            isLoading: snapshot.isLoading,
            canSkipToNext:
                resolvedQueueIndex >= 0 &&
                resolvedQueueIndex < queue.length - 1,
            canSkipToPrevious: resolvedQueueIndex > 0,
        }),
        [
            activeTrack,
            activeTrackId,
            queue.length,
            resolvedQueueIndex,
            snapshot.isLoading,
            snapshot.isPlaying,
        ],
    );

    return (
        <PlaybackCommandsContext.Provider value={commands}>
            <PlaybackTrackStateContext.Provider value={trackState}>
                <PlaybackContext.Provider
                    value={{
                        activeTrackId,
                        activeTrack,
                        isPlaying: snapshot.isPlaying,
                        isLoading: snapshot.isLoading,
                        progress: snapshot.progress,
                        queue,
                        queueIndex: resolvedQueueIndex,
                        upcoming:
                            resolvedQueueIndex >= 0
                                ? queue.slice(resolvedQueueIndex + 1)
                                : [],
                        shuffleMode: snapshot.shuffleMode ?? ShuffleMode.Off,
                        repeatMode: snapshot.repeatMode ?? RepeatMode.Off,
                        canSkipToNext:
                            resolvedQueueIndex >= 0 &&
                            resolvedQueueIndex < queue.length - 1,
                        canSkipToPrevious: resolvedQueueIndex > 0,
                        ...commands,
                    }}
                >
                    {children}
                </PlaybackContext.Provider>
            </PlaybackTrackStateContext.Provider>
        </PlaybackCommandsContext.Provider>
    );
}

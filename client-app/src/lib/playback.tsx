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
import { MusicItem, Playback } from "@apple-musickit";

import { useAppleMusic } from "./apple-music-auth";

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
    canSkipToNext: boolean;
    canSkipToPrevious: boolean;
    playQueue: (queue: PlaybackQueue) => Promise<void>;
    addToQueue: (tracks: readonly MusicItem[]) => Promise<void>;
    togglePlayback: (track: MusicItem) => Promise<void>;
    seekTo: (time: number) => Promise<void>;
    skipToNext: () => Promise<void>;
    skipToPrevious: () => Promise<void>;
};

const PlaybackContext = createContext<PlaybackInfo | null>(null);
type PlaybackCommands = Pick<
    PlaybackInfo,
    | "playQueue"
    | "addToQueue"
    | "togglePlayback"
    | "seekTo"
    | "skipToNext"
    | "skipToPrevious"
>;
const PlaybackCommandsContext = createContext<PlaybackCommands | null>(null);

export function usePlayback() {
    return useContext(PlaybackContext)!;
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
    const nativeQueueIndex = snapshotTrack
        ? queue.findIndex((track) => samePlayableItem(track, snapshotTrack))
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

    async function playQueue({ tracks, startIndex = 0 }: PlaybackQueue) {
        if (!isConnected) {
            Alert.alert(
                "Apple Music Not Connected",
                "Connect Apple Music from the Account tab before playing songs.",
            );
            return;
        }

        const playableTracks = tracks.filter((track) =>
            Boolean(track.playbackId ?? track.id),
        );
        if (playableTracks.length === 0) return;

        try {
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

        if (!isConnected) {
            Alert.alert(
                "Apple Music Not Connected",
                "Connect Apple Music from the Account tab before adding songs to the queue.",
            );
            throw new Error("Apple Music is not connected.");
        }

        try {
            await ensureConnected();

            if (queue.length > 0 && nativeQueueIndex >= 0) {
                await Playback.appendSongQueue(playableTracks);
                setQueue((currentQueue) => [
                    ...currentQueue,
                    ...playableTracks,
                ]);
                return;
            }

            if (activeTrack) {
                await Playback.appendSongQueue(playableTracks);
                setQueue([activeTrack, ...playableTracks]);
                setQueueIndex(0);
                return;
            }

            await playQueue({ tracks: playableTracks });
        } catch (e) {
            console.error("Failed to add tracks to playback queue:", e);
            Alert.alert("Playback Error", "Failed to add songs to the queue.");
            throw e;
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
            togglePlayback: (track) =>
                commandImplementationsRef.current!.togglePlayback(track),
            seekTo: (time) => commandImplementationsRef.current!.seekTo(time),
            skipToNext: () => commandImplementationsRef.current!.skipToNext(),
            skipToPrevious: () =>
                commandImplementationsRef.current!.skipToPrevious(),
        }),
        [],
    );

    return (
        <PlaybackCommandsContext.Provider value={commands}>
            <PlaybackContext.Provider
                value={{
                    activeTrackId,
                    activeTrack,
                    isPlaying: snapshot.isPlaying,
                    isLoading: snapshot.isLoading,
                    progress: snapshot.progress,
                    queue,
                    queueIndex: resolvedQueueIndex,
                    canSkipToNext:
                        resolvedQueueIndex >= 0 &&
                        resolvedQueueIndex < queue.length - 1,
                    canSkipToPrevious: resolvedQueueIndex > 0,
                    ...commands,
                }}
            >
                {children}
            </PlaybackContext.Provider>
        </PlaybackCommandsContext.Provider>
    );
}

function samePlayableItem(left: MusicItem, right: MusicItem) {
    const leftIds = new Set(
        [left.id, left.playbackId, left.catalogId, left.libraryId].filter(
            Boolean,
        ),
    );
    return [right.id, right.playbackId, right.catalogId, right.libraryId].some(
        (id) => id != null && leftIds.has(id),
    );
}

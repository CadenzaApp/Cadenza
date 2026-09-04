import {
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
    ReactNode,
} from "react";
import { Alert, AppState } from "react-native";
import { MusicItem, Playback, PlaybackQueueType } from "@apple-musickit";

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

export function usePlayback() {
    return useContext(PlaybackContext)!;
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
    const { isConnected, ensureConnected } = useAppleMusic();
    const snapshot = Playback.usePlaybackSnapshot();
    const [queue, setQueue] = useState<MusicItem[]>([]);
    const [queueIndex, setQueueIndex] = useState(-1);
    const queueRequestRevision = useRef(0);
    const snapshotTrack = snapshot.currentTrack ?? null;
    const queuedTrack = queue[queueIndex];
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

    async function startQueueTrack(
        tracks: MusicItem[],
        index: number,
        requestRevision: number,
    ) {
        const track = tracks[index];
        if (!track?.id && !track?.playbackId) return;

        const playbackType = track.playbackType ?? PlaybackQueueType.Song;

        if (requestRevision !== queueRequestRevision.current) return;
        await Playback.playTrack(track, playbackType);
    }

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

        let requestRevision: number | null = null;
        try {
            await ensureConnected();
            const boundedIndex = Math.max(
                0,
                Math.min(startIndex, playableTracks.length - 1),
            );
            requestRevision = ++queueRequestRevision.current;
            setQueue(playableTracks);
            setQueueIndex(boundedIndex);
            await startQueueTrack(
                playableTracks,
                boundedIndex,
                requestRevision,
            );
        } catch (e) {
            if (
                requestRevision === null ||
                requestRevision === queueRequestRevision.current
            ) {
                setQueue([]);
                setQueueIndex(-1);
            }
            console.error("Failed to start playback queue:", e);
            Alert.alert("Playback Error", "Failed to start playback.");
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
            Alert.alert("Playback Error", "Failed to update playback state.");
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
            return;
        }

        try {
            await ensureConnected();

            if (queue.length > 0) {
                setQueue((currentQueue) => [
                    ...currentQueue,
                    ...playableTracks,
                ]);
                return;
            }

            if (activeTrack) {
                setQueue([activeTrack, ...playableTracks]);
                setQueueIndex(0);
                return;
            }

            await playQueue({ tracks: playableTracks });
        } catch (e) {
            console.error("Failed to add tracks to playback queue:", e);
            Alert.alert("Playback Error", "Failed to add songs to the queue.");
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
        const nextIndex = queueIndex + 1;
        if (nextIndex >= queue.length) return;

        try {
            const requestRevision = ++queueRequestRevision.current;
            setQueueIndex(nextIndex);
            await startQueueTrack(queue, nextIndex, requestRevision);
        } catch (e) {
            console.error("Failed to skip to the next track:", e);
        }
    }

    async function skipToPrevious() {
        const previousIndex = queueIndex - 1;
        if (previousIndex < 0) return;

        try {
            const requestRevision = ++queueRequestRevision.current;
            setQueueIndex(previousIndex);
            await startQueueTrack(queue, previousIndex, requestRevision);
        } catch (e) {
            console.error("Failed to skip to the previous track:", e);
        }
    }

    return (
        <PlaybackContext.Provider
            value={{
                activeTrackId,
                activeTrack,
                isPlaying: snapshot.isPlaying,
                isLoading: snapshot.isLoading,
                progress: snapshot.progress,
                queue,
                queueIndex,
                canSkipToNext: queueIndex >= 0 && queueIndex < queue.length - 1,
                canSkipToPrevious: queueIndex > 0,
                playQueue,
                addToQueue,
                togglePlayback,
                seekTo,
                skipToNext,
                skipToPrevious,
            }}
        >
            {children}
        </PlaybackContext.Provider>
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

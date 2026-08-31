import { createContext, useContext, useEffect, ReactNode } from "react";
import { Alert, AppState } from "react-native";
import {
    MusicItem,
    Player,
    usePlaybackSnapshot,
    MusicKit,
    PlaybackQueueType,
} from "@apple-musickit";

type PlaybackInfo = {
    activeTrackId: string | null;
    activeTrack: MusicItem | null;
    isPlaying: boolean;
    isLoading: boolean;
    progress: number;
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
    const snapshot = usePlaybackSnapshot();
    const activeTrack = snapshot.currentTrack ?? null;
    const activeTrackId = activeTrack?.id ?? null;

    useEffect(() => {
        let active = true;

        const refreshPlaybackSnapshot = () => {
            if (!active || AppState.currentState !== "active") return;

            void Player.refreshPlaybackSnapshot().catch((error) => {
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

    async function togglePlayback(track: MusicItem) {
        const trackId = track.id;
        const isNewTrack = activeTrackId !== trackId;

        if (!trackId) return;

        try {
            if (!isNewTrack) {
                await Player.togglePlayerState();
            } else {
                const playbackType = trackId.startsWith("i.")
                    ? PlaybackQueueType.LibrarySong
                    : PlaybackQueueType.Song;
                await MusicKit.setPlaybackQueue(trackId, playbackType);
                Player.expectCurrentTrack(track);
                await Player.play();
            }
        } catch (e) {
            console.error("Failed to toggle playback:", e);
            Alert.alert("Playback Error", "Failed to update playback state.");
        }
    }

    async function seekTo(time: number) {
        const boundedTime = Math.max(
            0,
            Math.min(time, activeTrack?.songDuration ?? time),
        );
        try {
            await Player.seekToTime(boundedTime);
        } catch (e) {
            console.error("Failed to seek playback:", e);
        }
    }

    async function skipToNext() {
        try {
            await Player.skipToNextEntry();
        } catch (e) {
            console.error("Failed to skip to the next track:", e);
        }
    }

    async function skipToPrevious() {
        try {
            await Player.skipToPreviousEntry();
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

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { Alert } from "react-native";
import {
    MusicKit,
    Player,
    useIsPlaying,
    PlaybackQueueType,
} from "@apple-musickit";

type PlaybackInfo = {
    activeTrackId: string | null;
    isPlaying: boolean;
    togglePlayback: (trackId: string) => Promise<void>;
};

const PlaybackContext = createContext<PlaybackInfo | null>(null);

export function usePlayback() {
    return useContext(PlaybackContext)!;
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
    const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
    const isUpdatingPlayback = useRef(false);

    const isPlaying = useIsPlaying();

    async function togglePlayback(trackId: string) {
        if (isUpdatingPlayback.current) {
            return;
        }

        isUpdatingPlayback.current = true;

        try {
            if (activeTrackId === trackId) {
                if (isPlaying) {
                    await Player.pause();
                } else {
                    await Player.play();
                }
            } else {
                if (isPlaying) {
                    await Player.pause();
                }

                await MusicKit.setPlaybackQueue(
                    trackId,
                    PlaybackQueueType.LibrarySong,
                );
                setActiveTrackId(trackId);
                await Player.play();
            }
        } catch (e) {
            console.error("Failed to toggle playback:", e);
            Alert.alert("Playback Error", "Failed to update playback state.");
        } finally {
            isUpdatingPlayback.current = false;
        }
    }

    return (
        <PlaybackContext.Provider
            value={{ activeTrackId, isPlaying, togglePlayback }}
        >
            {children}
        </PlaybackContext.Provider>
    );
}

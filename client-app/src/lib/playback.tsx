import { createContext, useContext, useState, ReactNode } from "react";
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

    const isPlaying = useIsPlaying();

    async function togglePlayback(trackId: string) {
        try {
            if (activeTrackId === trackId) {
                await Player.togglePlayerState();
            } else {
                await MusicKit.setPlaybackQueue(trackId, PlaybackQueueType.Song);
                setActiveTrackId(trackId);
            }
        } catch (e) {
            console.error("Failed to toggle playback:", e);
            Alert.alert("Playback Error", "Failed to update playback state.");
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

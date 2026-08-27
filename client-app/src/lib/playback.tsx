import {
    createContext,
    useContext,
    useEffect,
    useState,
    ReactNode,
} from "react";
import { Alert } from "react-native";
import {
    MusicKit,
    MusicItem,
    Player,
    useIsPlaying,
    PlaybackQueueType,
} from "@apple-musickit";

type PlaybackInfo = {
    activeTrackId: string | null;
    activeTrack: MusicItem | null;
    isPlaying: boolean;
    progress: number;
    togglePlayback: (track: MusicItem | string) => Promise<void>;
    seekTo: (time: number) => Promise<void>;
    skipToNext: () => Promise<void>;
    skipToPrevious: () => Promise<void>;
};

const PlaybackContext = createContext<PlaybackInfo | null>(null);

export function usePlayback() {
    return useContext(PlaybackContext)!;
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
    const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
    const [activeTrack, setActiveTrack] = useState<MusicItem | null>(null);
    const [progress, setProgress] = useState(0);

    const isPlaying = useIsPlaying();

    useEffect(() => {
        if (!isPlaying || !activeTrack?.songDuration) return;

        const interval = setInterval(() => {
            setProgress((currentProgress) =>
                Math.min(
                    currentProgress + 1,
                    activeTrack.songDuration ?? currentProgress,
                ),
            );
        }, 1000);

        return () => clearInterval(interval);
    }, [activeTrack?.songDuration, isPlaying]);

    async function togglePlayback(track: MusicItem | string) {
        const trackId = typeof track === "string" ? track : track.id;

        if (!trackId) return;

        try {
            if (activeTrackId === trackId) {
                await Player.togglePlayerState();
            } else {
                const playbackType = trackId.startsWith("i.")
                    ? PlaybackQueueType.LibrarySong
                    : PlaybackQueueType.Song;
                await MusicKit.setPlaybackQueue(trackId, playbackType);
                setActiveTrackId(trackId);
                if (typeof track !== "string") {
                    setActiveTrack(track);
                } else {
                    // This fallback keeps the player useful when a legacy caller
                    // only knows an ID. List and detail views pass full metadata.
                    const [song] = await MusicKit.getSongInfo([trackId]);
                    if (song) setActiveTrack(song);
                }
                setProgress(0);

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
            // Update the player UI immediately after the user releases the
            // scrubber, then apply the native seek command.
            setProgress(boundedTime);
            await Player.seekToTime(boundedTime);
        } catch (e) {
            console.error("Failed to seek playback:", e);
        }
    }

    async function skipToNext() {
        try {
            await Player.skipToNextEntry();
            setProgress(0);
        } catch (e) {
            console.error("Failed to skip to the next track:", e);
        }
    }

    async function skipToPrevious() {
        try {
            await Player.skipToPreviousEntry();
            setProgress(0);
        } catch (e) {
            console.error("Failed to skip to the previous track:", e);
        }
    }

    return (
        <PlaybackContext.Provider
            value={{
                activeTrackId,
                activeTrack,
                isPlaying,
                progress,
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

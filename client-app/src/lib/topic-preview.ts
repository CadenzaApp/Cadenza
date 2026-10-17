import {
    createAudioPlayer,
    setAudioModeAsync,
    type AudioPlayer,
    type AudioStatus,
} from "expo-audio";
import { useSyncExternalStore } from "react";
import { MusicKit, Playback } from "@apple-musickit";

/**
 * One Apple Music preview clip playing from a social topic card. Pausing the
 * shared player is this module's job: the compact player stays on the song
 * that was playing, and that song resumes when the clip ends or is stopped.
 */

export type TopicPreviewState = {
    /** Which card started the clip. Two posts with the same song have different ids. */
    cardId: string | null;
    playing: boolean;
    loading: boolean;
    /** 0 to 1 of the clip. */
    progress: number;
};

const IDLE: TopicPreviewState = {
    cardId: null,
    playing: false,
    loading: false,
    progress: 0,
};

let state: TopicPreviewState = IDLE;
const listeners = new Set<() => void>();
let player: AudioPlayer | null = null;
let resumeMusicKit = false;
let generation = 0;
let audioModeReady = false;

function emit() {
    for (const listener of listeners) listener();
}

function setState(next: TopicPreviewState) {
    state = next;
    emit();
}

function getPlayer(): AudioPlayer | null {
    if (player) return player;
    try {
        player = createAudioPlayer(null, {
            updateInterval: 100,
            keepAudioSessionActive: true,
        });
        player.addListener("playbackStatusUpdate", onStatus);
        return player;
    } catch (error) {
        console.error("Failed to create the topic preview player:", error);
        return null;
    }
}

async function pauseMusicKitForPreview() {
    if (resumeMusicKit || !Playback.isAvailable() || !Playback.isPlaying()) {
        return;
    }
    resumeMusicKit = true;
    try {
        await Playback.pause();
    } catch (error) {
        resumeMusicKit = false;
        console.error("Failed to pause Apple Music for a preview:", error);
    }
}

async function ensureAudioMode() {
    if (audioModeReady) return;
    try {
        await setAudioModeAsync({
            playsInSilentMode: true,
            interruptionMode: "mixWithOthers",
            shouldPlayInBackground: false,
        });
        audioModeReady = true;
    } catch (error) {
        console.error("Failed to set audio mode for topic preview:", error);
    }
}

function onStatus(status: AudioStatus) {
    if (!state.cardId) return;
    const duration = status.duration > 0 ? status.duration : 0;
    const progress =
        duration > 0 ? Math.min(1, status.currentTime / duration) : state.progress;
    if (status.didJustFinish) {
        void stopPreview({ resume: true });
        return;
    }
    setState({
        ...state,
        playing: status.playing,
        loading: !status.playing && (status.isBuffering || !status.isLoaded),
        progress,
    });
}

async function stopPreview({ resume }: { resume: boolean }) {
    generation += 1;
    const current = getPlayer();
    current?.pause();
    void current?.seekTo(0);
    const shouldResume = resume && resumeMusicKit;
    resumeMusicKit = false;
    setState(IDLE);
    if (shouldResume && Playback.isAvailable()) {
        try {
            await Playback.play();
        } catch (error) {
            console.error("Failed to resume Apple Music after a preview:", error);
        }
    }
}

async function startPreview(cardId: string, url: string) {
    generation += 1;
    const gen = generation;
    const current = getPlayer();
    if (!current) {
        setState(IDLE);
        return;
    }
    current.pause();
    void current.seekTo(0);

    await pauseMusicKitForPreview();
    if (gen !== generation) return;

    await ensureAudioMode();
    if (gen !== generation) return;

    setState({
        cardId,
        playing: false,
        loading: true,
        progress: 0,
    });
    current.replace({ uri: url });
    current.play();
}

/**
 * Play or stop the preview for this card. `cardId` is unique per card so two
 * posts with the same song only show playing on the one you tapped. `songId`
 * is the MusicKit catalog id, used to look up the clip when `previewUrl` is
 * missing.
 */
export async function toggleTopicPreview(
    cardId: string,
    songId: string,
    previewUrl?: string | null,
) {
    if (state.cardId === cardId && (state.playing || state.loading)) {
        await stopPreview({ resume: true });
        return;
    }
    let url = previewUrl?.trim();
    if (!url) {
        generation += 1;
        const gen = generation;
        await pauseMusicKitForPreview();
        if (gen !== generation) return;
        setState({
            cardId,
            playing: false,
            loading: true,
            progress: 0,
        });
        try {
            const [song] = await MusicKit.getSongInfo([songId]);
            url = song?.previewUrl?.trim();
        } catch (error) {
            console.error("Failed to load a song preview URL:", error);
        }
        if (gen !== generation) return;
        if (!url) {
            await stopPreview({ resume: true });
            return;
        }
    }
    await startPreview(cardId, url);
}

/** Stop the clip and resume Apple Music if this preview had paused it. */
export async function stopTopicPreview() {
    if (!state.cardId) return;
    await stopPreview({ resume: true });
}

/** Stop the clip without resuming Apple Music. Used when the queue takes over. */
export async function abandonTopicPreview() {
    if (!state.cardId) return;
    await stopPreview({ resume: false });
}

export function getTopicPreviewState(): TopicPreviewState {
    return state;
}

export function subscribeTopicPreview(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function useTopicPreview(): TopicPreviewState {
    return useSyncExternalStore(
        subscribeTopicPreview,
        getTopicPreviewState,
        getTopicPreviewState,
    );
}

import {
    MusicKit,
    PlaybackQueueType,
    RepeatMode,
    ShuffleMode,
    type MusicItem,
    type PlaybackEngine,
    type PlaybackSnapshot,
} from "@apple-musickit";
import {
    createAudioPlayer,
    setAudioModeAsync,
    type AudioPlayer,
    type AudioStatus,
} from "expo-audio";

import { firstPlayableFrom, nextPreviewIndex } from "./preview-queue";

/**
 * A player that plays each song's ~30 second Apple Music preview, for someone
 * who cannot play full songs. Same commands as the native player, so
 * `setPlaybackEngine` can swap it in and nothing above `Playback` changes.
 *
 * Songs are looked up through the catalog, which needs only Cadenza's
 * developer token. The queue keeps every entry it was given, clip or not, so
 * positions match the queue `PlaybackProvider` mirrors; entries with no clip
 * are passed over when playing. Shuffle is remembered but not applied: the
 * mirrored queue is in order, so the clips play in order too.
 */
export function createPreviewPlayer(): PlaybackEngine {
    let queue: MusicItem[] = [];
    let index = 0;
    /** Whether the user wants sound. The audio player lags behind it. */
    let wantsPlay = false;
    let loadedUrl: string | null = null;
    let repeatMode = RepeatMode.Off;
    let shuffleMode = ShuffleMode.Off;
    let player: AudioPlayer | null = null;
    let audioModeReady = false;

    function audio(): AudioPlayer {
        if (player) return player;
        player = createAudioPlayer(null, { updateInterval: 250 });
        player.addListener("playbackStatusUpdate", onStatus);
        return player;
    }

    function playable(): boolean[] {
        return queue.map((track) => Boolean(track.previewUrl));
    }

    async function ensureAudioMode() {
        if (audioModeReady) return;
        try {
            await setAudioModeAsync({
                playsInSilentMode: true,
                interruptionMode: "doNotMix",
                shouldPlayInBackground: false,
            });
            audioModeReady = true;
        } catch (error) {
            console.error("Failed to set the preview audio mode:", error);
        }
    }

    /** Makes `target` the current entry, and plays it if the user wants sound. */
    async function load(target: number) {
        index = target;
        const url = queue[target]?.previewUrl ?? null;
        const current = audio();
        if (!url) {
            current.pause();
            loadedUrl = null;
            return;
        }
        if (url !== loadedUrl) {
            current.replace({ uri: url });
            loadedUrl = url;
        } else {
            await current.seekTo(0);
        }
        if (wantsPlay) {
            await ensureAudioMode();
            current.play();
        }
    }

    function onStatus(status: AudioStatus) {
        if (!status.didJustFinish) return;
        const next = nextPreviewIndex({
            index,
            playable: playable(),
            repeatMode,
        });
        if (next === null) {
            wantsPlay = false;
            void audio().seekTo(0);
            return;
        }
        void load(next);
    }

    /** Tracks for queue ids, one per id in order, so positions line up. */
    async function resolve(
        ids: readonly string[],
        types: readonly string[],
    ): Promise<MusicItem[]> {
        const songIds = ids.filter(
            (_, position) => (types[position] ?? "song") === "song",
        );
        const found = new Map(
            (songIds.length
                ? await MusicKit.getSongInfo([...songIds])
                : []
            ).map((song) => [song.catalogId ?? song.id, song]),
        );
        // a song Apple did not return still takes its place, with no clip
        return ids.map(
            (id) =>
                found.get(id) ?? {
                    id,
                    resourceKind: "song",
                    source: "catalog",
                    title: "",
                    playbackType: PlaybackQueueType.Song,
                },
        );
    }

    function boundedIndex(position: number): number | null {
        const target = Math.trunc(position);
        return Number.isFinite(target) && target >= 0 && target < queue.length
            ? target
            : null;
    }

    async function replaceQueue(tracks: MusicItem[], start: number) {
        audio().pause();
        wantsPlay = false;
        loadedUrl = null;
        queue = tracks;
        const clamped = Math.max(0, Math.min(start, tracks.length - 1));
        await load(firstPlayableFrom(clamped, playable()) ?? clamped);
    }

    async function play() {
        wantsPlay = true;
        if (!loadedUrl) {
            const first = firstPlayableFrom(index, playable());
            if (first === null) {
                wantsPlay = false;
                return;
            }
            await load(first);
            return;
        }
        await ensureAudioMode();
        audio().play();
    }

    async function pause() {
        wantsPlay = false;
        audio().pause();
    }

    return {
        play,
        pause,

        togglePlayerState: () => (wantsPlay ? pause() : play()),

        getPlaybackSnapshot: async (): Promise<PlaybackSnapshot> => {
            const current = audio();
            return {
                isPlaying: current.playing,
                isLoading:
                    wantsPlay &&
                    !current.playing &&
                    (current.isBuffering || !current.isLoaded),
                progress: current.currentTime,
                duration: current.duration > 0 ? current.duration : undefined,
                currentTrack: queue[index],
                shuffleMode,
                repeatMode,
            };
        },

        skipToNextEntry: async () => {
            const next = nextPreviewIndex({
                index,
                playable: playable(),
                repeatMode: RepeatMode.Off,
            });
            if (next !== null) await load(next);
        },

        skipToPreviousEntry: async () => {
            for (let target = index - 1; target >= 0; target -= 1) {
                if (queue[target]?.previewUrl) {
                    await load(target);
                    return;
                }
            }
        },

        restartCurrentEntry: async () => {
            await audio().seekTo(0);
        },

        seekToTime: async (time: number) => {
            const current = audio();
            const end = current.duration > 0 ? current.duration : time;
            await current.seekTo(Math.max(0, Math.min(time, end)));
        },

        setPlaybackQueue: async (id: string, type: string) => {
            if (type === "song") {
                await replaceQueue(await resolve([id], ["song"]), 0);
                return;
            }
            if (type === "album") {
                const { items } = await MusicKit.getAlbumSongs(id);
                await replaceQueue(items, 0);
                return;
            }
            throw new Error(`Previews cannot play a ${type} queue.`);
        },

        setSongPlaybackQueue: async (ids, types, startIndex) => {
            await replaceQueue(await resolve(ids, types), startIndex);
        },

        appendSongPlaybackQueue: async (ids, types) => {
            queue = [...queue, ...(await resolve(ids, types))];
        },

        insertSongsNextInQueue: async (ids, types) => {
            const songs = await resolve(ids, types);
            queue = [
                ...queue.slice(0, index + 1),
                ...songs,
                ...queue.slice(index + 1),
            ];
        },

        moveQueueItem: async (fromIndex, toIndex) => {
            const from = boundedIndex(fromIndex);
            const to = boundedIndex(toIndex);
            if (from === null || to === null || from === to) return;
            const next = [...queue];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            queue = next;
            // the playing entry keeps playing wherever it landed
            if (from === index) index = to;
            else if (from < index && to >= index) index -= 1;
            else if (from > index && to <= index) index += 1;
        },

        removeQueueItem: async (position) => {
            const target = boundedIndex(position);
            if (target === null) return;
            queue = queue.filter((_, entry) => entry !== target);
            if (target < index) {
                index -= 1;
                return;
            }
            if (target === index) {
                loadedUrl = null;
                await load(Math.min(index, queue.length - 1));
            }
        },

        playQueueItem: async (position) => {
            const target = boundedIndex(position);
            if (target === null || target === index) return;
            // skipping forward drops what was skipped over, the way the
            // native up next list does. skipping back just moves
            if (target > index) {
                queue = [...queue.slice(0, index + 1), ...queue.slice(target)];
                await load(index + 1);
            } else {
                await load(target);
            }
        },

        setShuffleMode: async (mode) => {
            shuffleMode = mode;
        },

        setRepeatMode: async (mode) => {
            repeatMode = mode;
        },
    };
}

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    ReactNode,
} from "react";
import { Alert, AppState } from "react-native";
import {
    MusicItem,
    Playback,
    RepeatMode,
    ShuffleMode,
    setPlaybackEngine,
} from "@apple-musickit";

import { useAccount } from "./account";
import { useAppleMusic } from "./apple-music-auth";
import { withoutExplicit } from "./explicit-filter";
import { useHideExplicit } from "./use-visible-items";
import type { PlaySource } from "./play-source";
import { upNextSongs } from "./now-playing-change";
import { useNowPlayingReporter } from "./now-playing-reporter";
import { usePlayRecorder } from "./play-recorder";
import { useReportOpenedSongs } from "./song-opened";
import {
    insertQueueEntriesNext,
    jumpToQueueEntry,
    moveQueueEntry,
    nearestQueuePosition,
    removeQueueEntry,
    type QueueState,
} from "./queue-order";
import { samePlayableItem } from "./playable-item";
import { abandonTopicPreview } from "./topic-preview";
import { createPreviewPlayer } from "./preview-player";
import { useMusicAccess } from "./use-music-access";
import { nextAction, previousAction } from "./transport";
import { logHandledError } from "./log";

export type PlaybackQueue = {
    tracks: MusicItem[];
    startIndex?: number;
    /**
     * The user tapped the start song, so it plays even when it is explicit
     * and explicit songs are hidden. Play all and shuffle leave it out.
     */
    chosenStart?: boolean;
    /** The playlist or query these tracks came from, for the play log. */
    source?: PlaySource;
};

/** A queue's source, and the tracks it started with. */
type QueueSource = { source: PlaySource; tracks: MusicItem[] };

type PlaybackInfo = {
    activeTrackId: string | null;
    activeTrack: MusicItem | null;
    isPlaying: boolean;
    isLoading: boolean;
    progress: number;
    /**
     * Seconds of what is playing: the song, or with previews its ~30 second
     * clip. Progress runs against this, not the song's own length.
     */
    duration: number;
    /** Playing Apple Music's preview clips, for want of a subscription. */
    isPreview: boolean;
    queue: MusicItem[];
    queueIndex: number;
    /** Everything queued after the entry that is playing, in order. */
    upcoming: MusicItem[];
    shuffleMode: ShuffleMode;
    repeatMode: RepeatMode;
    canSkipToNext: boolean;
    canSkipToPrevious: boolean;
    /**
     * Play, pause, skip, and seek are not the user's to use right now, like a
     * live session member whose role does not allow them.
     */
    controlsLocked: boolean;
    isPlayerCollapsed: boolean;
    playQueue: (queue: PlaybackQueue) => Promise<void>;
    addToQueue: (tracks: readonly MusicItem[]) => Promise<void>;
    playNext: (tracks: readonly MusicItem[]) => Promise<void>;
    /** Positions address the whole queue, not the upcoming slice. */
    moveQueueItem: (fromIndex: number, toIndex: number) => Promise<void>;
    removeQueueItem: (index: number) => Promise<void>;
    playQueueItem: (index: number) => Promise<void>;
    setShuffleMode: (mode: ShuffleMode) => Promise<void>;
    setRepeatMode: (mode: RepeatMode) => Promise<void>;
    /** `source` is recorded only when this starts a new track. */
    togglePlayback: (track: MusicItem, source?: PlaySource) => Promise<void>;
    seekTo: (time: number) => Promise<void>;
    skipToNext: () => Promise<void>;
    skipToPrevious: () => Promise<void>;
    setPlayerCollapsed: (collapsed: boolean) => void;
};

const PlaybackContext = createContext<PlaybackInfo | null>(null);

/** One for the app, so its queue survives a re-render. Made on first use. */
let previewPlayer: ReturnType<typeof createPreviewPlayer> | null = null;
export type PlaybackTrackState = Pick<
    PlaybackInfo,
    | "activeTrackId"
    | "activeTrack"
    | "isPlaying"
    | "isLoading"
    | "canSkipToNext"
    | "canSkipToPrevious"
    | "controlsLocked"
    | "isPlayerCollapsed"
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
    | "setPlayerCollapsed"
>;
const PlaybackCommandsContext = createContext<PlaybackCommands | null>(null);
const LocalPlaybackCommandsContext = createContext<PlaybackCommands | null>(
    null,
);

/** The commands a sink can take over. */
export type SinkableCommand = Exclude<
    keyof PlaybackCommands,
    "setShuffleMode" | "setRepeatMode" | "setPlayerCollapsed"
>;

/**
 * Takes over playback commands while something else owns what this phone
 * plays, like a live session. A command it leaves out runs on the local
 * player as usual.
 */
export type PlaybackSink = Partial<Pick<PlaybackCommands, SinkableCommand>> & {
    controlsLocked?: boolean;
};

const SetPlaybackSinkContext = createContext<
    ((sink: PlaybackSink | null) => void) | null
>(null);

/**
 * What the player shows in place of the local player, like a live session
 * playing on someone else's phone. The local player keeps running underneath;
 * play logging and now playing still read it.
 */
export type PlaybackView = {
    queue: MusicItem[];
    queueIndex: number;
    isPlaying: boolean;
    /** Seconds into `queue[queueIndex]`. */
    progress: number;
};

/** What this phone's player is really doing, under any view. */
export type LocalPlaybackState = Pick<
    PlaybackInfo,
    "activeTrack" | "isPlaying" | "progress" | "queue" | "queueIndex"
>;

const LocalPlaybackStateContext = createContext<LocalPlaybackState | null>(
    null,
);

/**
 * This phone's player, past any view. Only for whatever drives the local
 * player, like a live session.
 */
export function useLocalPlaybackState() {
    return useContext(LocalPlaybackStateContext)!;
}

const SetPlaybackViewContext = createContext<
    ((view: PlaybackView | null) => void) | null
>(null);

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

/**
 * Playback commands whose identity is stable across progress updates. They
 * go through the sink when one is set.
 */
export function usePlaybackCommands() {
    return useContext(PlaybackCommandsContext)!;
}

/**
 * The local player's commands, past any sink. Only for whatever drives the
 * local player on a sink's behalf.
 */
export function useLocalPlaybackCommands() {
    return useContext(LocalPlaybackCommandsContext)!;
}

/**
 * Routes playback commands through `sink` while it is set. One sink at a
 * time; null hands the commands back to the local player.
 */
export function usePlaybackSink(sink: PlaybackSink | null) {
    const setSink = useContext(SetPlaybackSinkContext)!;
    useEffect(() => {
        setSink(sink);
        return () => setSink(null);
    }, [setSink, sink]);
}

/**
 * Shows `view` in every player surface while it is set. One at a time; pair it
 * with a sink, since the commands still go to the local player otherwise.
 */
export function usePlaybackView(view: PlaybackView | null) {
    const setView = useContext(SetPlaybackViewContext)!;
    useEffect(() => {
        setView(view);
    }, [setView, view]);
    useEffect(() => () => setView(null), [setView]);
}

/** How often the player is read while the app is open. */
const FOREGROUND_POLL_MS = 750;
/** How often it is read while the app is in the background and music plays. */
const BACKGROUND_POLL_MS = 5_000;

export function PlaybackProvider({ children }: { children: ReactNode }) {
    const { isInitializing, ensureConnected } = useAppleMusic();
    const fullPlayback = useMusicAccess().can("fullPlayback");
    const hideExplicit = useHideExplicit();
    const snapshot = Playback.usePlaybackSnapshot();
    const [queue, setQueue] = useState<MusicItem[]>([]);
    const [queueIndex, setQueueIndex] = useState(-1);
    const [queueSource, setQueueSource] = useState<QueueSource | null>(null);
    const [isPlayerCollapsed, setIsPlayerCollapsed] = useState(false);
    // the ref is what commands read at call time; the state re-renders the
    // controls when the lock changes
    const sinkRef = useRef<PlaybackSink | null>(null);
    const [controlsLocked, setControlsLocked] = useState(false);
    const [view, setView] = useState<PlaybackView | null>(null);
    const setSink = useCallback((next: PlaybackSink | null) => {
        sinkRef.current = next;
        setControlsLocked(next?.controlsLocked ?? false);
    }, []);
    const commandImplementationsRef = useRef<Omit<
        PlaybackCommands,
        "setPlayerCollapsed"
    > | null>(null);
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
    // only a track the source queued is credited to it. one added with play
    // next or add to queue plays inside the same queue but did not come from
    // that playlist or query
    const activeSource = useMemo(
        () =>
            queueSource &&
            activeTrack &&
            queueSource.tracks.some((track) =>
                samePlayableItem(track, activeTrack),
            )
                ? queueSource.source
                : null,
        [activeTrack, queueSource],
    );
    // without a subscription the player plays 30 second previews, which
    // `PlaybackProvider` drives exactly like the native player. null until the
    // stored Apple Music session is restored, so startup does not flip
    // players on its way to the real answer
    const engine = isInitializing ? null : fullPlayback ? "native" : "preview";
    // the queue belongs to one engine and one account. a swap stops and
    // empties the old engine, and a new account (or none) gets a stopped
    // player. both start from an empty queue, reset while rendering, not in an
    // effect, so no frame shows the old one
    const accountId = useAccount().account?.id ?? null;
    const queueOwner = `${engine}:${accountId}`;
    const [currentQueueOwner, setCurrentQueueOwner] = useState(queueOwner);
    if (currentQueueOwner !== queueOwner) {
        setCurrentQueueOwner(queueOwner);
        setQueue([]);
        setQueueIndex(-1);
        setQueueSource(null);
    }
    useEffect(() => {
        if (engine === null) return;
        previewPlayer ??= createPreviewPlayer();
        setPlaybackEngine(engine === "native" ? null : previewPlayer);
    }, [engine]);
    const previousAccountId = useRef(accountId);
    useEffect(() => {
        const previous = previousAccountId.current;
        previousAccountId.current = accountId;
        // restoring the session on launch is not a change of account
        if (previous === null || previous === accountId) return;
        Playback.stop().catch((error: unknown) =>
            logHandledError(
                "Could not stop playback for the new account",
                error,
            ),
        );
    }, [accountId]);
    // counts plays for the activity tags, off the snapshot polled below. a
    // preview is not a listen, so it is not counted
    usePlayRecorder(snapshot, fullPlayback ? activeTrack : null, activeSource);
    // tells friends what is playing and what is next. a preview is not shared
    // either
    const shuffled = snapshot.shuffleMode === ShuffleMode.Songs;
    const upNext = useMemo(
        () => upNextSongs(queue, resolvedQueueIndex, shuffled),
        [queue, resolvedQueueIndex, shuffled],
    );
    useNowPlayingReporter(snapshot, fullPlayback ? activeTrack : null, upNext);
    // stores each opened song's metadata for the query builder's Metadata fields
    useReportOpenedSongs(activeTrack);

    useEffect(() => {
        let active = true;
        let lastRefreshAt = 0;

        // fast in the foreground, for the player UI. in the background only
        // the play recorder and the now playing reporter read the snapshot,
        // so a few seconds is plenty. iOS keeps the app running there only
        // while music plays, through the audio background mode in
        // app.config.js, and suspends it otherwise, so this costs nothing then
        const refreshPlaybackSnapshot = (force = false) => {
            if (!active) return;
            const now = Date.now();
            const foreground = AppState.currentState === "active";
            if (
                !force &&
                !foreground &&
                now - lastRefreshAt < BACKGROUND_POLL_MS
            )
                return;
            lastRefreshAt = now;

            void (async () => {
                try {
                    await Playback.refreshPlaybackSnapshot();
                } catch (error) {
                    console.warn("Failed to refresh playback snapshot:", error);
                }
            })();
        };

        refreshPlaybackSnapshot(true);
        const interval = setInterval(
            () => refreshPlaybackSnapshot(),
            FOREGROUND_POLL_MS,
        );
        const appStateSubscription = AppState.addEventListener(
            "change",
            (nextAppState) => {
                if (nextAppState === "active") refreshPlaybackSnapshot(true);
            },
        );

        return () => {
            active = false;
            clearInterval(interval);
            appStateSubscription.remove();
        };
    }, []);

    /** Starts a queue and throws on failure. Callers own the user-facing alert. */
    async function startQueue({
        tracks,
        startIndex = 0,
        chosenStart = false,
        source,
    }: PlaybackQueue) {
        // hiding explicit content drops explicit songs from every queue. only
        // a song the user tapped to start still plays
        const startTrack = chosenStart ? tracks[startIndex] : undefined;
        const keep = (track: MusicItem) =>
            Boolean(track.playbackId ?? track.id) &&
            (track === startTrack || !(hideExplicit && track.isExplicit));
        const playableTracks = tracks.filter(keep);
        if (playableTracks.length === 0) return;

        // previews need no Apple Music, so only full playback asks for it
        if (fullPlayback) await ensureConnected();
        await abandonTopicPreview();
        // the start song if it was kept, else the next kept song after it
        const boundedIndex = Math.min(
            tracks.slice(0, Math.max(0, startIndex)).filter(keep).length,
            playableTracks.length - 1,
        );
        const previousQueue = queue;
        const previousQueueIndex = queueIndex;
        const previousQueueSource = queueSource;
        setQueue(playableTracks);
        setQueueIndex(boundedIndex);
        // a new queue replaces the old source, even with none of its own
        setQueueSource(source ? { source, tracks: playableTracks } : null);
        try {
            await Playback.playSongQueue(playableTracks, boundedIndex);
        } catch (error) {
            setQueue(previousQueue);
            setQueueIndex(previousQueueIndex);
            setQueueSource(previousQueueSource);
            throw error;
        }
    }

    async function playQueue(nextQueue: PlaybackQueue) {
        try {
            await startQueue(nextQueue);
        } catch (e) {
            logHandledError("Failed to start playback queue", e);
            Alert.alert("Playback Error", "Failed to start playback.");
            throw e;
        }
    }

    async function togglePlayback(track: MusicItem, source?: PlaySource) {
        const trackId = track.id;
        const isNewTrack = activeTrackId !== trackId;

        if (!trackId) return;

        try {
            if (!isNewTrack) {
                await abandonTopicPreview();
                await Playback.togglePlayerState();
            } else {
                // Song lookup/list playback intentionally creates a one-song
                // queue today. Playlist and shuffle surfaces can pass a larger
                // track array through playQueue without changing this provider.
                await playQueue({ tracks: [track], chosenStart: true, source });
            }
        } catch (e) {
            logHandledError("Failed to toggle playback", e);
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
        const playableTracks = withoutExplicit(
            tracks.filter((track) => Boolean(track.playbackId ?? track.id)),
            hideExplicit,
        );
        if (playableTracks.length === 0) return;

        try {
            if (fullPlayback) await ensureConnected();

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
            logHandledError("Failed to add tracks to playback queue", e);
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
            logHandledError(`Failed to ${describe}`, e);
            setQueue(current.items);
            setQueueIndex(current.index);
            Alert.alert("Playback Error", `Failed to ${describe}.`);
            throw e;
        }
    }

    async function playNext(tracks: readonly MusicItem[]) {
        const playableTracks = withoutExplicit(
            tracks.filter((track) => Boolean(track.playbackId ?? track.id)),
            hideExplicit,
        );
        if (playableTracks.length === 0) return;

        if (fullPlayback) await ensureConnected();

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
        await abandonTopicPreview();
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
            logHandledError("Failed to set the shuffle mode", e);
        }
    }

    async function setRepeatMode(mode: RepeatMode) {
        try {
            await Playback.setRepeatMode(mode);
        } catch (e) {
            logHandledError("Failed to set the repeat mode", e);
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
            logHandledError("Failed to seek playback", e);
        }
    }

    /** Back to the start of the playing song, then playing or paused. */
    async function restartCurrent(then: "play" | "pause" | "keep") {
        await Playback.restartCurrentEntry();
        if (then === "play") await Playback.play();
        if (then === "pause") await Playback.pause();
    }

    async function skipToNext() {
        await abandonTopicPreview();
        const action = nextAction({
            index: resolvedQueueIndex,
            length: queue.length,
            repeatMode: snapshot.repeatMode ?? RepeatMode.Off,
        });

        try {
            switch (action) {
                case "next":
                    await Playback.skipToNextEntry();
                    setQueueIndex(resolvedQueueIndex + 1);
                    break;
                case "wrap":
                    await playQueueItem(0);
                    break;
                case "replay":
                    await restartCurrent("play");
                    break;
                case "rewind":
                    await restartCurrent("pause");
                    break;
            }
        } catch (e) {
            logHandledError("Failed to skip to the next track", e);
        }
    }

    async function skipToPrevious() {
        await abandonTopicPreview();
        const action = previousAction({
            index: resolvedQueueIndex,
            progress: snapshot.progress,
        });

        try {
            if (action === "restart") {
                await restartCurrent("keep");
                return;
            }
            await Playback.skipToPreviousEntry();
            setQueueIndex(resolvedQueueIndex - 1);
        } catch (e) {
            logHandledError("Failed to skip to the previous track", e);
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
    const localCommands = useMemo<PlaybackCommands>(
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
            togglePlayback: (track, source) =>
                commandImplementationsRef.current!.togglePlayback(
                    track,
                    source,
                ),
            seekTo: (time) => commandImplementationsRef.current!.seekTo(time),
            skipToNext: () => commandImplementationsRef.current!.skipToNext(),
            skipToPrevious: () =>
                commandImplementationsRef.current!.skipToPrevious(),
            setPlayerCollapsed: setIsPlayerCollapsed,
        }),
        [],
    );
    // each call reads the sink at call time, so the identity stays stable
    const commands = useMemo<PlaybackCommands>(() => {
        const via = () => sinkRef.current ?? {};
        return {
            ...localCommands,
            playQueue: (queue) =>
                (via().playQueue ?? localCommands.playQueue)(queue),
            addToQueue: (tracks) =>
                (via().addToQueue ?? localCommands.addToQueue)(tracks),
            playNext: (tracks) =>
                (via().playNext ?? localCommands.playNext)(tracks),
            moveQueueItem: (fromIndex, toIndex) =>
                (via().moveQueueItem ?? localCommands.moveQueueItem)(
                    fromIndex,
                    toIndex,
                ),
            removeQueueItem: (index) =>
                (via().removeQueueItem ?? localCommands.removeQueueItem)(index),
            playQueueItem: (index) =>
                (via().playQueueItem ?? localCommands.playQueueItem)(index),
            togglePlayback: (track, source) =>
                (via().togglePlayback ?? localCommands.togglePlayback)(
                    track,
                    source,
                ),
            seekTo: (time) => (via().seekTo ?? localCommands.seekTo)(time),
            skipToNext: () => (via().skipToNext ?? localCommands.skipToNext)(),
            skipToPrevious: () =>
                (via().skipToPrevious ?? localCommands.skipToPrevious)(),
        };
    }, [localCommands]);
    // what the player surfaces show: the view while one is set, else the
    // local player
    const shownQueue = view?.queue ?? queue;
    const shownIndex = view ? view.queueIndex : resolvedQueueIndex;
    const shownTrack = view
        ? (view.queue[view.queueIndex] ?? null)
        : activeTrack;
    const shownTrackId = shownTrack?.id ?? null;
    const shownPlaying = view ? view.isPlaying : snapshot.isPlaying;
    const shownLoading = view ? false : snapshot.isLoading;
    const localState = useMemo<LocalPlaybackState>(
        () => ({
            activeTrack,
            isPlaying: snapshot.isPlaying,
            progress: snapshot.progress,
            queue,
            queueIndex: resolvedQueueIndex,
        }),
        [
            activeTrack,
            snapshot.isPlaying,
            snapshot.progress,
            queue,
            resolvedQueueIndex,
        ],
    );
    const trackState = useMemo<PlaybackTrackState>(
        () => ({
            activeTrackId: shownTrackId,
            activeTrack: shownTrack,
            isPlaying: shownPlaying,
            isLoading: shownLoading,
            // back and forward always do something once a song is loaded
            canSkipToNext: Boolean(shownTrack) && !controlsLocked,
            canSkipToPrevious: Boolean(shownTrack) && !controlsLocked,
            controlsLocked,
            isPlayerCollapsed,
        }),
        [
            shownTrack,
            shownTrackId,
            shownLoading,
            shownPlaying,
            controlsLocked,
            isPlayerCollapsed,
        ],
    );

    return (
        <SetPlaybackViewContext.Provider value={setView}>
            <LocalPlaybackStateContext.Provider value={localState}>
                <SetPlaybackSinkContext.Provider value={setSink}>
                    <LocalPlaybackCommandsContext.Provider
                        value={localCommands}
                    >
                        <PlaybackCommandsContext.Provider value={commands}>
                            <PlaybackTrackStateContext.Provider
                                value={trackState}
                            >
                                <PlaybackContext.Provider
                                    value={{
                                        activeTrackId: shownTrackId,
                                        activeTrack: shownTrack,
                                        isPlaying: shownPlaying,
                                        isLoading: shownLoading,
                                        progress:
                                            view?.progress ?? snapshot.progress,
                                        duration:
                                            view || fullPlayback
                                                ? (shownTrack?.songDuration ??
                                                  0)
                                                : (snapshot.duration ?? 0),
                                        isPreview: !view && !fullPlayback,
                                        queue: shownQueue,
                                        queueIndex: shownIndex,
                                        upcoming:
                                            shownIndex >= 0
                                                ? shownQueue.slice(
                                                      shownIndex + 1,
                                                  )
                                                : [],
                                        shuffleMode:
                                            snapshot.shuffleMode ??
                                            ShuffleMode.Off,
                                        repeatMode:
                                            snapshot.repeatMode ??
                                            RepeatMode.Off,
                                        canSkipToNext: trackState.canSkipToNext,
                                        canSkipToPrevious:
                                            trackState.canSkipToPrevious,
                                        controlsLocked,
                                        isPlayerCollapsed,
                                        ...commands,
                                    }}
                                >
                                    {children}
                                </PlaybackContext.Provider>
                            </PlaybackTrackStateContext.Provider>
                        </PlaybackCommandsContext.Provider>
                    </LocalPlaybackCommandsContext.Provider>
                </SetPlaybackSinkContext.Provider>
            </LocalPlaybackStateContext.Provider>
        </SetPlaybackViewContext.Provider>
    );
}

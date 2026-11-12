import { useEffect, useMemo, useRef, useState } from "react";
import {
    Playback,
    PlaybackQueueType,
    RepeatMode,
    ShuffleMode,
    type MusicItem,
} from "@apple-musickit";

import {
    useLocalPlaybackCommands,
    useLocalPlaybackState,
} from "@/lib/playback";
import type { PlaySource } from "@/lib/play-source";
import { serverNow } from "@/lib/realtime";
import { isPendingEntry } from "@/lib/session-optimistic";
import { playbackPositionMs } from "@/lib/session-playback";
import {
    useLiveSessionWrites,
    type LiveSession,
    type LiveSessionEntry,
} from "@/lib/routes/live-sessions";

import {
    hostTarget,
    reconcile,
    shouldCorrectDrift,
    type QueueOp,
} from "./session-reconciler";

/** The host reports at least this often while playing. */
const HOST_HEARTBEAT_MS = 10_000;
/** A jump this far off the expected position is a seek worth reporting. */
const SEEK_REPORT_MS = 3_000;
/** Versions from our own reports, kept so we do not re-apply our own change. */
const OWN_VERSIONS_KEPT = 20;

/** A session entry as a track the native player can queue. */
export function entryToTrack(entry: LiveSessionEntry): MusicItem {
    return {
        id: entry.song_id,
        catalogId: entry.song_id,
        resourceKind: "song",
        source: "catalog",
        playbackType: PlaybackQueueType.Song,
        title: entry.title,
        artistName: entry.artist ?? undefined,
        artworkUrl: entry.artwork_url ?? undefined,
        songDuration: entry.duration_ms ? entry.duration_ms / 1000 : undefined,
    };
}

function songIdOf(track: MusicItem): string {
    return track.catalogId ?? track.id;
}

/**
 * Whether the session plays on this phone: always on the host, and on a
 * member in `synced` mode. Both need full playback.
 */
export function playsHere(session: LiveSession | null, canPlay: boolean) {
    return (
        session !== null &&
        canPlay &&
        (session.my_role === "host" || session.my_listen_mode === "synced")
    );
}

/** The entries that should be in the phone's queue: playing one first. */
export function sessionTarget(session: LiveSession): LiveSessionEntry[] {
    const entries = [
        ...(session.current ? [session.current] : []),
        ...session.up_next,
    ];
    const at = entries.findIndex(
        (entry) => entry.entry_id === session.playback.entry_id,
    );
    return at > 0 ? entries.slice(at) : entries;
}

/**
 * Plays a live session on this phone. On the host it is always on: the
 * host's phone is the session's speaker and the source of truth for what is
 * really playing, so it also reports back. On a member it runs only in
 * `synced` mode, follows the session, and never reports.
 *
 * Each new snapshot is applied, a guess the app made before the server
 * answered included (`session-optimistic.ts`): the queue is brought in line with
 * `reconcile` (replaced only when the current song differs), play or pause is
 * matched, and drift past 2 s is corrected at most every 5 s, or right away
 * for a new command like a seek. A version the host's own report produced is
 * skipped, since the phone is already there. A version that lands while the
 * last one is still being applied is applied after it.
 *
 * The session's shuffle and repeat are its own, so the phone's shuffle stays
 * off and its repeat is on only to loop one song. Repeat all is the server
 * putting played songs back in the queue.
 *
 * The host's phone goes where the session is only when someone steered it
 * (`command_seq` moved), or when it first picks up a session playing another
 * song. Any other version, like a join or a queue edit, only lines up the
 * songs after the one the phone plays. Otherwise the server's projection,
 * which lags the phone, would pause, rewind, or skip it.
 *
 * The host's own player controls keep working: a skip or seek on the phone
 * shows up in the next report and the session follows. Each report carries the
 * last command the phone followed, so one sent before the phone caught up with
 * a command cannot undo it.
 *
 * A member leaving gets their old queue back, paused.
 */
export function useSessionPlayer(
    session: LiveSession | null,
    canPlay: boolean,
) {
    const playback = useLocalPlaybackState();
    // the local player itself: the app's commands go to the session while
    // it plays here, through `useSessionSink`
    const commands = useLocalPlaybackCommands();
    const writes = useLiveSessionWrites(session?.session_id ?? "none");

    const isHost = session?.my_role === "host";
    const active = playsHere(session, canPlay);

    const target = useMemo(
        () => (session ? sessionTarget(session) : []),
        [session],
    );
    const source = useMemo<PlaySource | undefined>(
        () =>
            session
                ? {
                      kind: "live_session",
                      id: session.session_id,
                      name: session.name,
                  }
                : undefined,
        [session],
    );

    const ownVersions = useRef<number[]>([]);
    /** The last `command_seq` followed, by session. */
    const followed = useRef<{ sessionId: string; seq: number } | null>(null);
    const lastSeekAt = useRef(0);
    const applying = useRef(false);
    /** The last version applied or skipped. */
    const appliedVersion = useRef<number | null>(null);
    /** The last snapshot applied or skipped, so a guess at the same version runs too. */
    const appliedSession = useRef<LiveSession | null>(null);
    // bumped when an apply finishes, so a version that landed meanwhile runs
    const [settled, setSettled] = useState(0);
    const savedQueue = useRef<{ tracks: MusicItem[]; index: number } | null>(
        null,
    );

    // a member's own queue is kept while they play along, and comes back after
    const wasActive = useRef(false);
    useEffect(() => {
        if (active && !wasActive.current && !isHost) {
            savedQueue.current = {
                tracks: playback.queue,
                index: playback.queueIndex,
            };
        }
        if (!active && wasActive.current && savedQueue.current) {
            const saved = savedQueue.current;
            savedQueue.current = null;
            void (async () => {
                try {
                    if (saved.tracks.length > 0) {
                        await commands.playQueue({
                            tracks: saved.tracks,
                            startIndex: Math.max(0, saved.index),
                            chosenStart: true,
                        });
                        await Playback.pause();
                    }
                } catch (error) {
                    console.warn("Could not restore the queue:", error);
                }
            })();
        }
        if (!active) {
            followed.current = null;
            appliedVersion.current = null;
            appliedSession.current = null;
        }
        wasActive.current = active;
        // only the edge matters, not every queue change
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);

    // apply each new snapshot
    const version = session?.version;
    useEffect(() => {
        if (!active || !session || version === undefined) return;
        if (applying.current || appliedSession.current === session) return;
        const newVersion = appliedVersion.current !== version;
        const seq = session.playback.command_seq;
        const last = followed.current;
        const sameSession = last?.sessionId === session.session_id;
        // a command since the last version this phone followed
        const commanded = sameSession && seq !== last.seq;
        // our own report, unless a command came in with it
        if (
            newVersion &&
            ownVersions.current.includes(version) &&
            sameSession &&
            !commanded
        ) {
            appliedVersion.current = version;
            appliedSession.current = session;
            return;
        }
        applying.current = true;
        appliedVersion.current = version;
        appliedSession.current = session;

        const phoneSong = playback.activeTrack
            ? songIdOf(playback.activeTrack)
            : null;
        // a host picking up a session follows it only when it has another
        // song to go to; a new, empty one leaves the phone playing
        const steered =
            !isHost ||
            (sameSession
                ? commanded
                : target.length > 0 && phoneSong !== target[0].song_id);
        followed.current = { sessionId: session.session_id, seq };
        const queueTarget = steered
            ? target
            : hostTarget(
                  [
                      ...(session.current ? [session.current] : []),
                      ...session.up_next,
                  ],
                  phoneSong,
              );

        void (async () => {
            try {
                await applyModes();
                await applyQueue();
                if (steered) await applyPlayState();
            } catch (error) {
                console.warn("Could not follow the live session:", error);
            } finally {
                applying.current = false;
                setSettled((n) => n + 1);
            }
        })();

        async function applyModes() {
            if (playback.shuffleMode !== ShuffleMode.Off) {
                await commands.setShuffleMode(ShuffleMode.Off);
            }
            const mode = session!.playback.repeat_mode;
            // one song on repeat all loops the same way as repeat one
            const loopOne =
                mode === "one" || (mode === "all" && target.length === 1);
            const repeat = loopOne ? RepeatMode.One : RepeatMode.Off;
            if (playback.repeatMode !== repeat) {
                await commands.setRepeatMode(repeat);
            }
        }

        async function applyQueue() {
            if (queueTarget.length === 0) return;
            const ops = reconcile(
                {
                    songIds: playback.queue.map(songIdOf),
                    index: playback.queueIndex,
                },
                queueTarget.map((entry) => entry.song_id),
            );
            for (const op of ops) await runOp(op);
        }

        async function runOp(op: QueueOp) {
            switch (op.kind) {
                case "replace":
                    await commands.playQueue({
                        tracks: queueTarget.map(entryToTrack),
                        startIndex: 0,
                        chosenStart: true,
                        source,
                    });
                    lastSeekAt.current = 0;
                    break;
                case "move":
                    await commands.moveQueueItem(op.from, op.to);
                    break;
                case "insert": {
                    const byId = new Map(
                        queueTarget.map((entry) => [entry.song_id, entry]),
                    );
                    const tracks = op.songIds
                        .map((id) => byId.get(id))
                        .filter((entry) => entry !== undefined)
                        .map(entryToTrack);
                    if (op.where === "end") await commands.addToQueue(tracks);
                    else await commands.playNext(tracks);
                    break;
                }
                case "remove":
                    await commands.removeQueueItem(op.index);
                    break;
            }
        }

        async function applyPlayState() {
            // steered past the last song: the session plays nothing now
            if (target.length === 0) {
                if (playback.isPlaying) await Playback.pause();
                return;
            }
            const wantPlaying = session!.playback.is_playing;
            if (wantPlaying !== playback.isPlaying && playback.activeTrack) {
                await commands.togglePlayback(playback.activeTrack);
            }
            const expected = playbackPositionMs(session!.playback, serverNow());
            const now = Date.now();
            // a command, like a seek or back, is followed at once; only drift
            // waits out the interval
            const sinceSeek = commanded
                ? Number.POSITIVE_INFINITY
                : now - lastSeekAt.current;
            if (
                shouldCorrectDrift(
                    playback.progress * 1000,
                    expected,
                    sinceSeek,
                )
            ) {
                lastSeekAt.current = now;
                await commands.seekTo(expected / 1000);
            }
        }
        // a new snapshot is the trigger; the rest is read at that moment
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, session, settled]);

    // the host reports what its phone is really doing
    const activeSong = playback.activeTrack
        ? songIdOf(playback.activeTrack)
        : null;
    const reportedEntry = target.find((entry) => entry.song_id === activeSong);
    const last = useRef<{
        entryId: number | null;
        isPlaying: boolean;
        positionMs: number;
        at: number;
    } | null>(null);

    useEffect(() => {
        if (!active || !isHost || !session) return;
        // a song added a moment ago has no real id yet; the snapshot that
        // gives it one runs this again
        if (reportedEntry && isPendingEntry(reportedEntry)) return;
        const now = Date.now();
        const positionMs = Math.round(playback.progress * 1000);
        const entryId = reportedEntry?.entry_id ?? null;
        const prev = last.current;
        const expected = prev
            ? prev.positionMs + (prev.isPlaying ? now - prev.at : 0)
            : 0;
        const due =
            !prev ||
            prev.entryId !== entryId ||
            prev.isPlaying !== playback.isPlaying ||
            Math.abs(positionMs - expected) > SEEK_REPORT_MS ||
            (playback.isPlaying && now - prev.at >= HOST_HEARTBEAT_MS);
        if (!due || applying.current) return;
        last.current = {
            entryId,
            isPlaying: playback.isPlaying,
            positionMs,
            at: now,
        };

        void (async () => {
            try {
                const seen = followed.current;
                const result = await writes.sendPlayback({
                    kind: "report",
                    entry_id: entryId,
                    position_ms: positionMs,
                    is_playing: playback.isPlaying,
                    command_seq:
                        seen?.sessionId === session.session_id
                            ? seen.seq
                            : null,
                });
                if (result?.version != null) {
                    ownVersions.current = [
                        ...ownVersions.current,
                        result.version,
                    ].slice(-OWN_VERSIONS_KEPT);
                }
            } catch (error) {
                // the next change or heartbeat reports again
                console.warn("Could not report session playback:", error);
            }
        })();
        // reacts to what the phone is doing
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        active,
        isHost,
        reportedEntry?.entry_id,
        playback.isPlaying,
        playback.progress,
    ]);
}

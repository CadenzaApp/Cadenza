import { useEffect, useMemo, useRef } from "react";
import { Playback, PlaybackQueueType, type MusicItem } from "@apple-musickit";

import { useLocalPlaybackCommands, usePlayback } from "@/lib/playback";
import type { PlaySource } from "@/lib/play-source";
import { serverNow } from "@/lib/realtime";
import {
    useLiveSessionWrites,
    type LiveSession,
    type LiveSessionEntry,
} from "@/lib/routes/live-sessions";

import {
    expectedPositionMs,
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
 * Each new snapshot version is applied: the queue is brought in line with
 * `reconcile` (replaced only when the current song differs), play or pause is
 * matched, and drift past 2 s is corrected at most every 5 s. A version the
 * host's own report produced is skipped, since the phone is already there.
 *
 * The host's own player controls keep working: a skip or seek on the phone
 * shows up in the next report and the session follows. Members control the
 * session from its screen.
 *
 * A member leaving gets their old queue back, paused.
 */
export function useSessionPlayer(
    session: LiveSession | null,
    canPlay: boolean,
) {
    const playback = usePlayback();
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
    const lastSeekAt = useRef(0);
    const applying = useRef(false);
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
        wasActive.current = active;
        // only the edge matters, not every queue change
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);

    // apply each new snapshot
    const version = session?.version;
    useEffect(() => {
        if (!active || !session || version === undefined) return;
        if (ownVersions.current.includes(version)) return;
        if (applying.current) return;
        applying.current = true;

        void (async () => {
            try {
                await applyQueue();
                await applyPlayState();
            } catch (error) {
                console.warn("Could not follow the live session:", error);
            } finally {
                applying.current = false;
            }
        })();

        async function applyQueue() {
            if (target.length === 0) return;
            const ops = reconcile(
                {
                    songIds: playback.queue.map(songIdOf),
                    index: playback.queueIndex,
                },
                target.map((entry) => entry.song_id),
            );
            for (const op of ops) await runOp(op);
        }

        async function runOp(op: QueueOp) {
            switch (op.kind) {
                case "replace":
                    await commands.playQueue({
                        tracks: target.map(entryToTrack),
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
                    const entry = target.find((e) => e.song_id === op.songId);
                    if (!entry) break;
                    const next = playback.queueIndex + 1;
                    await commands.playNext([entryToTrack(entry)]);
                    if (op.at !== next)
                        await commands.moveQueueItem(next, op.at);
                    break;
                }
                case "remove":
                    await commands.removeQueueItem(op.index);
                    break;
            }
        }

        async function applyPlayState() {
            const wantPlaying = session!.playback.is_playing;
            if (wantPlaying !== playback.isPlaying && playback.activeTrack) {
                await commands.togglePlayback(playback.activeTrack);
            }
            const expected = expectedPositionMs(
                session!.playback.position_ms,
                Date.parse(session!.playback.as_of),
                wantPlaying,
                serverNow(),
            );
            const now = Date.now();
            if (
                shouldCorrectDrift(
                    playback.progress * 1000,
                    expected,
                    now - lastSeekAt.current,
                )
            ) {
                lastSeekAt.current = now;
                await commands.seekTo(expected / 1000);
            }
        }
        // a new version is the trigger; the rest is read at that moment
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, version]);

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
                const result = await writes.sendPlayback({
                    kind: "report",
                    entry_id: entryId,
                    position_ms: positionMs,
                    is_playing: playback.isPlaying,
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

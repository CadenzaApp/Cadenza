import assert from "node:assert/strict";
import test from "node:test";

import type { LiveSession, LiveSessionEntry } from "./routes/live-sessions.ts";
import {
    addSongs,
    isPendingEntry,
    moveEntry,
    playbackCommand,
    removeEntry,
    reviewSuggestion,
} from "./session-optimistic.ts";

const NOW = Date.parse("2026-11-12T00:00:10Z");

const entry = (entry_id: number, status = "queued"): LiveSessionEntry => ({
    entry_id,
    song_id: `song-${entry_id}`,
    title: `Song ${entry_id}`,
    artist: null,
    artwork_url: null,
    duration_ms: 200_000,
    status: status as LiveSessionEntry["status"],
    position: 0,
    added_by: null,
    added_by_username: null,
    added_at: "2026-11-12T00:00:00Z",
});

const session = (changes: Partial<LiveSession> = {}): LiveSession =>
    ({
        current: entry(1),
        up_next: [entry(2), entry(3), entry(4)],
        suggestions: [entry(9, "suggested")],
        can: {
            suggest: true,
            edit_queue: true,
            control: true,
            review: true,
            manage: true,
        },
        playback: {
            entry_id: 1,
            position_ms: 0,
            is_playing: true,
            as_of: "2026-11-12T00:00:00Z",
            command_seq: 7,
            shuffle: false,
            repeat_mode: "off",
        },
        ...changes,
    }) as LiveSession;

const ids = (entries: LiveSessionEntry[]) => entries.map((e) => e.entry_id);
const song = {
    song_id: "x",
    title: "X",
    artist: null,
    artwork_url: null,
    duration_ms: null,
};

test("remove and move change only the upcoming songs", () => {
    assert.deepEqual(ids(removeEntry(session(), 3).up_next), [2, 4]);
    assert.deepEqual(ids(removeEntry(session(), 9).suggestions), []);
    assert.deepEqual(ids(moveEntry(session(), 4, 0).up_next), [4, 2, 3]);
    assert.deepEqual(ids(moveEntry(session(), 2, 99).up_next), [3, 4, 2]);
});

test("approving a suggestion queues it last; rejecting drops it", () => {
    const approved = reviewSuggestion(session(), 9, true);
    assert.deepEqual(ids(approved.up_next), [2, 3, 4, 9]);
    assert.equal(approved.up_next.at(-1)!.status, "queued");
    assert.deepEqual(reviewSuggestion(session(), 9, false).up_next.length, 3);
});

test("added songs land where asked, with pending ids", () => {
    const next = addSongs(session(), [song], { position: 0 }, NOW);
    assert.equal(next.up_next.length, 4);
    assert.ok(isPendingEntry(next.up_next[0]!));
    const end = addSongs(session(), [song], {}, NOW);
    assert.ok(isPendingEntry(end.up_next.at(-1)!));
});

test("someone who cannot edit the queue suggests instead", () => {
    const can = { ...session().can, edit_queue: false };
    const next = addSongs(session({ can }), [song], {}, NOW);
    assert.equal(next.up_next.length, 3);
    assert.equal(next.suggestions.at(-1)!.status, "suggested");
});

test("play now starts the first added song and moves command_seq", () => {
    const next = addSongs(session(), [song, song], { playNow: true }, NOW);
    assert.ok(isPendingEntry(next.current!));
    assert.equal(next.playback.entry_id, next.current!.entry_id);
    assert.equal(next.playback.position_ms, 0);
    assert.equal(next.playback.command_seq, 8);
    assert.deepEqual(ids(next.up_next).slice(1), [2, 3, 4]);
});

test("next and jump advance; back near the start waits on the server", () => {
    const next = playbackCommand(session(), { kind: "next" }, NOW)!;
    assert.equal(next.current!.entry_id, 2);
    assert.deepEqual(ids(next.up_next), [3, 4]);
    assert.equal(next.playback.command_seq, 8);

    const jumped = playbackCommand(
        session(),
        { kind: "jump", entry_id: 4 },
        NOW,
    )!;
    assert.equal(jumped.current!.entry_id, 4);
    assert.deepEqual(ids(jumped.up_next), []);

    // 10 s in, so back restarts
    const back = playbackCommand(session(), { kind: "previous" }, NOW)!;
    assert.equal(back.playback.position_ms, 0);
    const early = session({
        playback: { ...session().playback, as_of: "2026-11-12T00:00:09Z" },
    });
    assert.equal(playbackCommand(early, { kind: "previous" }, NOW), null);
});

test("pause holds the position it reached", () => {
    const paused = playbackCommand(session(), { kind: "pause" }, NOW)!;
    assert.equal(paused.playback.is_playing, false);
    assert.equal(paused.playback.position_ms, 10_000);
});

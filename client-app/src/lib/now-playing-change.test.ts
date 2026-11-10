import assert from "node:assert/strict";
import test from "node:test";

import type { MusicItem } from "@apple-musickit";

import {
    HEARTBEAT_MS,
    nowPlayingAction,
    shareableSongId,
    upNextSongs,
    type NowPlayingSample,
} from "./now-playing-change.ts";

const sent: NowPlayingSample = {
    songId: "1",
    upNextKey: "2|3",
    isPlaying: true,
    positionMs: 10_000,
    at: 0,
};

test("a new song or the first sample is sent", () => {
    assert.equal(nowPlayingAction(null, sent), "put");
    assert.equal(
        nowPlayingAction(sent, { ...sent, songId: "2", at: 750 }),
        "put",
    );
});

test("playing forward on schedule is not sent", () => {
    assert.equal(
        nowPlayingAction(sent, { ...sent, positionMs: 10_750, at: 750 }),
        null,
    );
});

test("a pause, a seek, and a heartbeat are sent", () => {
    assert.equal(
        nowPlayingAction(sent, { ...sent, isPlaying: false, at: 750 }),
        "put",
    );
    assert.equal(
        nowPlayingAction(sent, { ...sent, positionMs: 90_000, at: 750 }),
        "put",
    );
    assert.equal(
        nowPlayingAction(sent, {
            ...sent,
            positionMs: 10_000 + HEARTBEAT_MS,
            at: HEARTBEAT_MS,
        }),
        "put",
    );
});

test("paused does not heartbeat", () => {
    const paused = { ...sent, isPlaying: false };
    assert.equal(
        nowPlayingAction(paused, { ...paused, at: HEARTBEAT_MS * 2 }),
        null,
    );
});

test("nothing shareable clears once", () => {
    const nothing = { ...sent, songId: null };
    assert.equal(nowPlayingAction(sent, nothing), "clear");
    assert.equal(nowPlayingAction(nothing, nothing), null);
    assert.equal(nowPlayingAction(null, nothing), null);
});

test("only catalog ids are shareable", () => {
    const track = (fields: Partial<MusicItem>) =>
        ({ id: "x", source: "library", ...fields }) as MusicItem;
    assert.equal(shareableSongId(track({ catalogId: "123" })), "123");
    assert.equal(shareableSongId(track({ id: "i.abc" })), null);
    assert.equal(
        shareableSongId(track({ id: "456", source: "catalog" })),
        "456",
    );
    assert.equal(shareableSongId(null), null);
});

test("a queue edit is sent", () => {
    assert.equal(
        nowPlayingAction(sent, {
            ...sent,
            upNextKey: "4|3",
            positionMs: 10_750,
            at: 750,
        }),
        "put",
    );
});

test("up next is the two after the current song, none while shuffled", () => {
    const track = (id: string) =>
        ({ id, source: "catalog", title: `t${id}` }) as MusicItem;
    const queue = ["1", "2", "3", "4"].map(track);
    assert.deepEqual(
        upNextSongs(queue, 0, false).map((song) => song.song_id),
        ["2", "3"],
    );
    assert.deepEqual(upNextSongs(queue, 3, false), []);
    assert.deepEqual(upNextSongs(queue, 0, true), []);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
    INITIAL_PLAY_TRACKER_STATE,
    PLAY_THRESHOLD_SECONDS,
    playThreshold,
    trackPlay,
    type PlaySample,
    type PlayTrackerState,
} from "./play-tracker.ts";

/** Runs the samples in order and returns every song a play was counted for. */
function run(samples: PlaySample[], start = INITIAL_PLAY_TRACKER_STATE) {
    let state: PlayTrackerState = start;
    const counted: string[] = [];
    for (const sample of samples) {
        const next = trackPlay(state, sample);
        state = next.state;
        if (next.countedSongId) counted.push(next.countedSongId);
    }
    return counted;
}

function playing(songId: string, progress: number, duration = 200) {
    return { songId, isPlaying: true, progress, duration };
}

test("threshold is 15 seconds, or the whole of a shorter song", () => {
    assert.equal(PLAY_THRESHOLD_SECONDS, 15);
    assert.equal(playThreshold(200), 15);
    assert.equal(playThreshold(15), 15);
    // a shorter song counts within a second of its end
    assert.equal(playThreshold(10), 9);
    assert.equal(playThreshold(0.5), 0);
    assert.equal(playThreshold(undefined), 15);
    assert.equal(playThreshold(0), 15);
});

test("a song shorter than the threshold counts only near its end", () => {
    assert.deepEqual(
        run([playing("a", 0, 10), playing("a", 5, 10), playing("a", 8.5, 10)]),
        [],
    );
    assert.deepEqual(
        run([playing("a", 0, 10), playing("a", 5, 10), playing("a", 9.4, 10)]),
        ["a"],
    );
});

test("a listen counts once it passes the threshold, and only once", () => {
    assert.deepEqual(
        run([
            playing("a", 0),
            playing("a", 15),
            playing("a", 31),
            playing("a", 60),
        ]),
        ["a"],
    );
});

test("a skip before the threshold does not count", () => {
    assert.deepEqual(
        run([playing("a", 0), playing("a", 10), playing("b", 0)]),
        [],
    );
});

test("a paused song does not count, even seeked past the threshold", () => {
    assert.deepEqual(
        run([{ songId: "a", isPlaying: false, progress: 90, duration: 200 }]),
        [],
    );
});

test("the next song is a new listen", () => {
    assert.deepEqual(
        run([playing("a", 35), playing("b", 1), playing("b", 40)]),
        ["a", "b"],
    );
});

test("repeat one, or skipping back to the start, is a new listen", () => {
    assert.deepEqual(
        run([
            playing("a", 35),
            playing("a", 199),
            playing("a", 1),
            playing("a", 31),
        ]),
        ["a", "a"],
    );
});

test("a small seek back is the same listen", () => {
    assert.deepEqual(
        run([playing("a", 35), playing("a", 33), playing("a", 40)]),
        ["a"],
    );
});

test("no song, no play", () => {
    assert.deepEqual(
        run([{ songId: null, isPlaying: true, progress: 90 }]),
        [],
    );
});

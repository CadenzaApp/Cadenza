import assert from "node:assert/strict";
import test from "node:test";

import {
    INITIAL_PLAY_TRACKER_STATE,
    PLAY_THRESHOLD_SECONDS,
    playThreshold,
    trackPlay,
    type PlaySample,
    type PlayTrackerState,
    type TrackedEvent,
} from "./play-tracker.ts";

/** Runs the samples in order and returns every event, in order. */
function run(samples: PlaySample[], start = INITIAL_PLAY_TRACKER_STATE) {
    let state: PlayTrackerState = start;
    const events: TrackedEvent[] = [];
    for (const sample of samples) {
        const next = trackPlay(state, sample);
        state = next.state;
        events.push(...next.events);
    }
    return { events, state };
}

/** Just the songs a play was counted for, which is what playcount means. */
function counted(samples: PlaySample[]) {
    return run(samples)
        .events.filter((e) => e.type === "play_counted")
        .map((e) => e.songId);
}

/** Every event type in order, for asserting the shape of a listen. */
function types(samples: PlaySample[]) {
    return run(samples).events.map((e) => e.type);
}

function playing(songId: string, progress: number, duration = 200) {
    return { songId, isPlaying: true, progress, duration };
}

// ----- the threshold, unchanged behaviour -----

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
        counted([
            playing("a", 0, 10),
            playing("a", 5, 10),
            playing("a", 8.5, 10),
        ]),
        [],
    );
    assert.deepEqual(
        counted([
            playing("a", 0, 10),
            playing("a", 5, 10),
            playing("a", 9.4, 10),
        ]),
        ["a"],
    );
});

test("a listen counts once it passes the threshold, and only once", () => {
    assert.deepEqual(
        counted([
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
        counted([playing("a", 0), playing("a", 10), playing("b", 0)]),
        [],
    );
});

test("a paused song does not count, even seeked past the threshold", () => {
    assert.deepEqual(
        counted([
            { songId: "a", isPlaying: false, progress: 90, duration: 200 },
        ]),
        [],
    );
});

test("the next song is a new listen", () => {
    assert.deepEqual(
        counted([playing("a", 35), playing("b", 1), playing("b", 40)]),
        ["a", "b"],
    );
});

test("repeat one, or skipping back to the start, is a new listen", () => {
    assert.deepEqual(
        counted([
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
        counted([playing("a", 35), playing("a", 33), playing("a", 40)]),
        ["a"],
    );
});

test("no song, no play", () => {
    assert.deepEqual(
        counted([{ songId: null, isPlaying: true, progress: 90 }]),
        [],
    );
});

// ----- play_start -----

test("a listen opens with play_start", () => {
    assert.deepEqual(types([playing("a", 0)]), ["play_start"]);
});

test("play_start fires once per listen, not per sample", () => {
    assert.deepEqual(
        types([playing("a", 0), playing("a", 1), playing("a", 2)]),
        ["play_start"],
    );
});

test("nothing playing emits nothing", () => {
    assert.deepEqual(
        types([{ songId: null, isPlaying: false, progress: 0 }]),
        [],
    );
});

// ----- play_complete and skip, the terminal events -----

test("a listen that reaches the end completes", () => {
    assert.deepEqual(
        types([
            playing("a", 20, 200),
            playing("a", 199, 200),
            playing("b", 0, 200),
        ]),
        ["play_start", "play_counted", "play_complete", "play_start"],
    );
});

test("a listen that stops early is a skip", () => {
    assert.deepEqual(
        types([
            playing("a", 20, 200),
            playing("a", 40, 200),
            playing("b", 0, 200),
        ]),
        ["play_start", "play_counted", "skip", "play_start"],
    );
});

test("every listen ends in exactly one of complete or skip", () => {
    const { events } = run([
        playing("a", 1),
        playing("a", 199),
        playing("b", 1),
        playing("b", 40),
        playing("c", 1),
    ]);
    const terminal = events.filter(
        (e) => e.type === "play_complete" || e.type === "skip",
    );
    // a and b both ended, c is still playing
    assert.deepEqual(
        terminal.map((e) => [e.songId, e.type]),
        [
            ["a", "play_complete"],
            ["b", "skip"],
        ],
    );
});

test("a song with no known duration ends as a skip, not a completion", () => {
    const { events } = run([
        { songId: "a", isPlaying: true, progress: 40 },
        { songId: "b", isPlaying: true, progress: 0 },
    ]);
    assert.equal(
        events.find((e) => e.songId === "a" && e.type === "skip")?.type,
        "skip",
    );
});

test("repeat one ends the first listen before starting the next", () => {
    assert.deepEqual(types([playing("a", 199, 200), playing("a", 1, 200)]), [
        "play_start",
        "play_counted",
        "play_complete",
        "play_start",
    ]);
});

test("the queue running out ends the listen", () => {
    assert.deepEqual(
        types([
            playing("a", 199, 200),
            { songId: null, isPlaying: false, progress: 0 },
        ]),
        ["play_start", "play_counted", "play_complete"],
    );
});

// ----- listened time -----

test("listened time is the playing progress, not the position", () => {
    // starts at 100 (a seek or a resume), then plays three samples forward
    const { events } = run([
        playing("a", 100),
        playing("a", 100.75),
        playing("a", 101.5),
        playing("b", 0),
    ]);
    const terminal = events.find((e) => e.type === "skip");
    // 0.75 + 0.75 credited, the opening sample has nothing before it to measure
    assert.equal(terminal?.listenedSeconds, 1.5);
    assert.equal(terminal?.positionSeconds, 101.5);
});

test("a pause adds no listened time", () => {
    const { events } = run([
        playing("a", 10),
        { songId: "a", isPlaying: false, progress: 10.75, duration: 200 },
        playing("b", 0),
    ]);
    assert.equal(events.find((e) => e.type === "skip")?.listenedSeconds, 0);
});

test("a gap where the app was not sampling is not credited", () => {
    // 60 seconds of progress in one sample is a background stretch, not listening
    // we can vouch for
    const { events } = run([
        playing("a", 10),
        playing("a", 70),
        playing("b", 0),
    ]);
    assert.equal(events.find((e) => e.type === "skip")?.listenedSeconds, 0);
});

test("listened time resets with each listen", () => {
    const { events } = run([
        playing("a", 10),
        playing("a", 10.75),
        playing("b", 10),
        playing("b", 10.5),
        playing("c", 0),
    ]);
    const skips = events.filter((e) => e.type === "skip");
    assert.equal(skips[0]?.listenedSeconds, 0.75);
    assert.equal(skips[1]?.listenedSeconds, 0.5);
});

// ----- seek -----

test("a backward jump inside the song is a seek", () => {
    const { events } = run([playing("a", 100), playing("a", 40)]);
    const seek = events.find((e) => e.type === "seek");
    assert.equal(seek?.fromSeconds, 100);
    assert.equal(seek?.positionSeconds, 40);
});

test("a small step back is not a seek", () => {
    // sampling jitter can move progress back a little; that is not a user action
    assert.ok(!types([playing("a", 100), playing("a", 98)]).includes("seek"));
});

test("a jump back to the start is a new listen, not a seek", () => {
    // it ends the listen and opens a new one, and never reports a seek
    assert.deepEqual(types([playing("a", 100), playing("a", 1)]), [
        "play_start",
        "play_counted",
        "skip",
        "play_start",
    ]);
});

test("a forward jump is not reported as a seek", () => {
    // the app stops sampling in the background, so a forward jump is ambiguous
    assert.ok(!types([playing("a", 10), playing("a", 120)]).includes("seek"));
});

// ----- one terminal event per listen -----

test("a listen interrupted and resumed still counts once", () => {
    // the app leaving the foreground must not reset the tracker: doing so made
    // the next sample look like a new listen and counted the same play twice
    let state = INITIAL_PLAY_TRACKER_STATE;
    const events: TrackedEvent[] = [];
    for (const sample of [playing("a", 1, 300), playing("a", 20, 300)]) {
        const next = trackPlay(state, sample);
        state = next.state;
        events.push(...next.events);
    }
    // ... the app goes inactive here and comes back, state untouched ...
    for (const sample of [playing("a", 140, 300), playing("a", 299, 300)]) {
        const next = trackPlay(state, sample);
        state = next.state;
        events.push(...next.events);
    }

    assert.deepEqual(
        events.filter((e) => e.type === "play_counted").length,
        1,
        "one continuous listen is one play",
    );
    assert.deepEqual(
        events.filter((e) => e.type === "play_start").length,
        1,
        "and one start",
    );
});

test("a listen emits no terminal event until it actually ends", () => {
    const { events } = run([playing("a", 20, 300), playing("a", 100, 300)]);
    const terminal = events.filter(
        (e) => e.type === "play_complete" || e.type === "skip",
    );
    assert.deepEqual(terminal, [], "still playing, so nothing ended");
});

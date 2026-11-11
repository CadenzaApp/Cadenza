import assert from "node:assert/strict";
import test from "node:test";

import {
    shouldOpenListenAlong,
    type ListenAlongState,
} from "./listen-along.ts";

const playing: ListenAlongState = {
    enabled: true,
    canPlay: true,
    inSession: false,
    isPlaying: true,
    songId: "1",
    openedFor: null,
};

test("playing a shareable song with listen along on opens a session", () => {
    assert.equal(shouldOpenListenAlong(playing), true);
});

test("nothing opens when off, paused, previewing, or a library song", () => {
    assert.equal(shouldOpenListenAlong({ ...playing, enabled: false }), false);
    assert.equal(
        shouldOpenListenAlong({ ...playing, isPlaying: false }),
        false,
    );
    assert.equal(shouldOpenListenAlong({ ...playing, canPlay: false }), false);
    assert.equal(shouldOpenListenAlong({ ...playing, songId: null }), false);
});

test("nothing opens while in a session or before that is known", () => {
    assert.equal(shouldOpenListenAlong({ ...playing, inSession: true }), false);
    assert.equal(shouldOpenListenAlong({ ...playing, inSession: null }), false);
});

test("an ended session reopens on the next song, not the same one", () => {
    assert.equal(shouldOpenListenAlong({ ...playing, openedFor: "1" }), false);
    assert.equal(
        shouldOpenListenAlong({ ...playing, openedFor: "1", songId: "2" }),
        true,
    );
});

import assert from "node:assert/strict";
import test from "node:test";

import type { LiveSessionPlayback } from "./routes/live-sessions";
import {
    holdSessionModes,
    pendingSessionModes,
    withPendingModes,
} from "./session-modes.ts";

const PLAYBACK: LiveSessionPlayback = {
    entry_id: 1,
    position_ms: 0,
    is_playing: true,
    as_of: "2026-01-01T00:00:00Z",
    command_seq: 0,
    shuffle: false,
    repeat_mode: "off",
};

const shown = (id: string) =>
    withPendingModes(PLAYBACK, pendingSessionModes(id));

test("a held mode shows until released", () => {
    const release = holdSessionModes("a", { shuffle: true });
    assert.equal(shown("a").shuffle, true);
    assert.equal(shown("a").repeat_mode, "off");
    release();
    assert.equal(pendingSessionModes("a"), undefined);
    assert.equal(shown("a"), PLAYBACK);
});

test("a later tap outlives the earlier one's release", () => {
    const first = holdSessionModes("b", { repeat_mode: "all" });
    const second = holdSessionModes("b", { repeat_mode: "one" });
    first();
    assert.equal(shown("b").repeat_mode, "one");
    second();
    assert.equal(shown("b").repeat_mode, "off");
});

test("modes are held apart, per session", () => {
    const shuffle = holdSessionModes("c", { shuffle: true });
    const repeat = holdSessionModes("c", { repeat_mode: "all" });
    shuffle();
    assert.equal(shown("c").shuffle, false);
    assert.equal(shown("c").repeat_mode, "all");
    assert.equal(shown("d"), PLAYBACK);
    repeat();
});

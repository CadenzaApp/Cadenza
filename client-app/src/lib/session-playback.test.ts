import assert from "node:assert/strict";
import test from "node:test";

import { playbackPositionMs } from "./session-playback.ts";

test("position runs while playing only", () => {
    const at = (ms: number) => new Date(ms).toISOString();
    const playback = {
        position_ms: 10_000,
        as_of: at(1_000),
        is_playing: true,
    };
    assert.equal(playbackPositionMs(playback, 4_000), 13_000);
    assert.equal(
        playbackPositionMs({ ...playback, is_playing: false }, 4_000),
        10_000,
    );
    assert.equal(
        playbackPositionMs({ ...playback, as_of: at(5_000) }, 4_000),
        10_000,
    );
});

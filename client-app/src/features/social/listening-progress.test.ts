import assert from "node:assert/strict";
import test from "node:test";

import { formatTrackTime, livePositionMs } from "./listening-progress.ts";

const asOf = "2026-11-10T18:00:00Z";
const anchor = Date.parse(asOf);

test("position runs forward from as_of and stops at the end", () => {
    assert.equal(livePositionMs(60_000, asOf, 200_000, anchor + 5_000), 65_000);
    assert.equal(
        livePositionMs(60_000, asOf, 200_000, anchor + 500_000),
        200_000,
    );
});

test("a clock behind as_of does not run backward", () => {
    assert.equal(livePositionMs(60_000, asOf, 200_000, anchor - 3_000), 60_000);
});

test("no duration means no cap", () => {
    assert.equal(livePositionMs(0, asOf, null, anchor + 999_000), 999_000);
});

test("times read like a player", () => {
    assert.equal(formatTrackTime(62_400), "1:02");
    assert.equal(formatTrackTime(229_000), "3:49");
    assert.equal(formatTrackTime(-5), "0:00");
});

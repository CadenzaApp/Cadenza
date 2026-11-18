import assert from "node:assert/strict";
import { test } from "node:test";

import { formatReleaseMonthYear } from "./release-date.ts";

test("formats the release month in UTC and handles missing dates", () => {
    const timestamp = Date.UTC(2020, 0, 1);
    assert.equal(
        formatReleaseMonthYear(timestamp),
        new Date(timestamp).toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
        }),
    );
    assert.equal(formatReleaseMonthYear(undefined), undefined);
    assert.equal(formatReleaseMonthYear(NaN), undefined);
    assert.ok(formatReleaseMonthYear(0));
});

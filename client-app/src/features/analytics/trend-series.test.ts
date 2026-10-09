import assert from "node:assert/strict";
import test from "node:test";

import { averagePerMonthByYear } from "./trend-series.ts";

test("folds months into each year's average per month", () => {
    const { years, overall } = averagePerMonthByYear([
        { bucket: "2025-11-01", value: 10 },
        { bucket: "2025-12-01", value: 30 },
        { bucket: "2026-01-01", value: 6 },
        { bucket: "2026-02-01", value: 0 },
        { bucket: "2026-03-01", value: 0 },
    ]);
    // 2025 only has the two months it was lived in
    assert.deepEqual(years, [
        { bucket: "2025", value: 20 },
        { bucket: "2026", value: 2 },
    ]);
    assert.equal(overall, 46 / 5);
});

test("an empty series has no years and a zero average", () => {
    assert.deepEqual(averagePerMonthByYear([]), { years: [], overall: 0 });
});

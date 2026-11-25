import assert from "node:assert/strict";
import test from "node:test";
import { converter } from "culori";
import {
    calendarChartDays,
    averageDailyUsers,
    chartSegments,
    adminNebulaPalette,
    summarizeEndings,
} from "./admin-utils.ts";

test("a partial week leaves future dates blank and out of average DAU", () => {
    const days = calendarChartDays(
        [
            { day: "2026-11-23", active_users: 2 },
            { day: "2026-11-24", active_users: 3 },
            { day: "2026-11-25", active_users: 0 },
        ],
        "2026-11-23T00:00:00Z",
        "2026-11-30T00:00:00Z",
    );
    assert.equal(days.length, 7);
    assert.equal(days[6].day, "2026-11-29");
    assert.equal(days[3].active_users, undefined);
    assert.equal(averageDailyUsers(days), 5 / 3);
    assert.deepEqual(chartSegments(days, "active_users"), [
        [
            { index: 0, value: 2 },
            { index: 1, value: 3 },
            { index: 2, value: 0 },
        ],
    ]);
});

test("a partial month keeps its remaining chart positions", () => {
    const days = calendarChartDays(
        [{ day: "2026-11-15", plays: 4, listening_ms: 120000 }],
        "2026-11-01T00:00:00Z",
        "2026-12-01T00:00:00Z",
    );
    assert.equal(days.length, 30);
    assert.deepEqual(chartSegments(days, "plays"), [[{ index: 14, value: 4 }]]);
    assert.deepEqual(chartSegments(days, "listening_ms"), [
        [{ index: 14, value: 120000 }],
    ]);
    assert.equal(days[29].plays, undefined);
});

test("past zeroes plot normally while missing days never join a line", () => {
    const days = calendarChartDays(
        [
            { day: "2026-11-23", posts: 0 },
            { day: "2026-11-25", posts: 7 },
        ],
        "2026-11-23T00:00:00Z",
        "2026-11-26T00:00:00Z",
    );
    assert.deepEqual(chartSegments(days, "posts"), [
        [{ index: 0, value: 0 }],
        [{ index: 2, value: 7 }],
    ]);
    assert.equal(averageDailyUsers(days), 0);
});

test("year charts retain every day including leap day", () => {
    const days = calendarChartDays(
        [],
        "2024-01-01T00:00:00Z",
        "2025-01-01T00:00:00Z",
    );
    assert.equal(days.length, 366);
    assert.equal(days[59].day, "2024-02-29");
    assert.equal(chartSegments(days, "posts").length, 0);
});

test("chart labels use UTC calendar dates and extrema ignore future blanks", async () => {
    const { chartDate, chartExtrema } = await import("./admin-utils.ts");
    assert.equal(chartDate("2026-11-14"), "Nov 14, 2026");
    assert.deepEqual(
        chartExtrema(
            [
                { day: "2026-11-14", plays: 5 },
                { day: "2026-11-15", plays: 9 },
                { day: "2026-11-16" },
            ],
            "plays",
        ),
        { min: 5, max: 9 },
    );
    assert.deepEqual(chartExtrema([{ day: "2026-11-14", plays: 0 }], "plays"), {
        min: 0,
        max: 0,
    });
    assert.deepEqual(chartExtrema([], "plays"), { min: 0, max: 0 });
});

const toLab = converter("oklab");

test("admin nebula preserves accent and uses 30/70 percent OKLab neutral mixes", () => {
    const accent = "#607080";
    const original = toLab(accent)!;
    for (const scheme of ["dark", "light"] as const) {
        const palette = adminNebulaPalette(accent, scheme);
        assert.equal(palette[0], accent);
        assert.equal(palette.length, 3);
        for (const [index, weight] of [0.3, 0.7].entries()) {
            const mixed = toLab(palette[index + 1])!;
            assert.ok(
                Math.abs(
                    mixed.l -
                        (original.l * (1 - weight) +
                            (scheme === "dark" ? 0 : 1) * weight),
                ) < 0.006,
            );
            assert.ok(Math.abs(mixed.a - original.a * (1 - weight)) < 0.006);
            assert.ok(Math.abs(mixed.b - original.b * (1 - weight)) < 0.006);
        }
    }
});
test("an invalid accent does not produce invalid nebula shades", () => {
    assert.deepEqual(adminNebulaPalette("invalid", "dark"), ["invalid"]);
});

const days = [
    { day: "2026-11-23", skips: 2, early_skips: 1, completed: 7 },
    { day: "2026-11-24", skips: 1, early_skips: 2, completed: 0 },
];
test("song endings summarize the period until a day is selected", () => {
    assert.deepEqual(summarizeEndings(days, null), {
        skips: 3,
        early_skips: 3,
        completed: 7,
    });
    assert.deepEqual(summarizeEndings(days, "2026-11-23"), {
        skips: 2,
        early_skips: 1,
        completed: 7,
    });
    assert.deepEqual(summarizeEndings(days, "2026-11-25"), {
        skips: 0,
        early_skips: 0,
        completed: 0,
    });
    assert.deepEqual(summarizeEndings([], null), {
        skips: 0,
        early_skips: 0,
        completed: 0,
    });
});

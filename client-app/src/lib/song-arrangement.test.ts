import assert from "node:assert/strict";
import test from "node:test";

import {
    arrangeFieldJSON,
    defaultDirection,
    directionLabels,
    formatDuration,
    groupLabel,
    hasDirection,
    isArranged,
    NO_ARRANGEMENT,
    releaseDay,
    sameField,
    sectionLabel,
    sectionsOf,
    type ArrangeField,
} from "./song-arrangement.ts";

const artist: ArrangeField = { kind: "metadata", key: "artist" };
const tag = (
    name: string,
    type: "basic" | "checkbox" | "number" | "datetime",
    source: "own" | "activity" | "suggested" = "own",
): ArrangeField => ({
    kind: "tag",
    tagId: name.length,
    name,
    color: "#000000",
    type,
    source,
});

test("none is no sort and no group", () => {
    assert.equal(isArranged(NO_ARRANGEMENT), false);
    assert.equal(
        isArranged({
            sort: { field: artist, direction: "ascending" },
            group: null,
        }),
        true,
    );
});

test("play counts and the latest play start with the most and the newest", () => {
    assert.equal(
        defaultDirection({ kind: "metadata", key: "total_plays" }),
        "descending",
    );
    assert.equal(
        defaultDirection(tag("My Plays", "number", "activity")),
        "descending",
    );
    assert.equal(
        defaultDirection(tag("Last Played", "datetime", "activity")),
        "descending",
    );
    assert.equal(
        defaultDirection(tag("First Played", "datetime", "activity")),
        "ascending",
    );
    // a tag of the user's that happens to share the name is theirs, not listening
    assert.equal(defaultDirection(tag("My Plays", "number")), "ascending");
    assert.equal(defaultDirection(artist), "ascending");
});

test("a basic tag has no direction to pick", () => {
    assert.equal(hasDirection(tag("gym", "basic")), false);
    assert.equal(hasDirection(tag("liked", "checkbox")), true);
    assert.deepEqual(directionLabels(tag("liked", "checkbox")), {
        ascending: "True first",
        descending: "False first",
    });
    assert.deepEqual(directionLabels(artist), {
        ascending: "A to Z",
        descending: "Z to A",
    });
});

test("fields go to the backend tagged by kind", () => {
    assert.deepEqual(
        arrangeFieldJSON({ field: artist, direction: "descending" }),
        { field: "metadata", key: "artist", direction: "descending" },
    );
    assert.deepEqual(
        arrangeFieldJSON({
            field: tag("gym", "basic"),
            direction: "ascending",
        }),
        { field: "tag", tag_id: 3, direction: "ascending" },
    );
    assert.equal(sameField(tag("gym", "basic"), tag("abc", "number")), true);
    assert.equal(sameField(artist, { kind: "metadata", key: "album" }), false);
    assert.equal(sameField(null, null), true);
});

test("groups slice the ordered ids in turn", () => {
    const sections = sectionsOf(
        ["a", "b", "c", "d"],
        [
            { state: "value", value: "Prince", count: 2 },
            { state: "no_value", value: null, count: 1 },
            { state: "not_applied", value: null, count: 1 },
        ],
        artist,
    );
    assert.deepEqual(
        sections.map((section) => [section.label, section.songIds]),
        [
            ["Artist: Prince", ["a", "b"]],
            ["Artist: No value", ["c"]],
            ["Artist: Not tagged", ["d"]],
        ],
    );
    assert.equal(new Set(sections.map((section) => section.key)).size, 3);
});

test("group headers name the field they are grouped by", () => {
    const value = (raw: string) => ({ state: "value" as const, value: raw });
    assert.equal(sectionLabel(value("Prince"), artist), "Artist: Prince");
    assert.equal(
        sectionLabel({ state: "value", value: null }, tag("Gym", "basic")),
        "Gym: Tagged",
    );
    assert.equal(
        sectionLabel(
            { state: "not_applied", value: null },
            tag("Gym", "basic"),
        ),
        "Gym: Not tagged",
    );
    assert.equal(
        sectionLabel(value("225000"), { kind: "metadata", key: "duration" }),
        "Duration: 3:45",
    );
});

test("group values read the way their type does", () => {
    const value = (raw: string) => ({ state: "value" as const, value: raw });
    assert.equal(
        groupLabel({ state: "value", value: null }, tag("gym", "basic")),
        "Tagged",
    );
    assert.equal(groupLabel(value("true"), tag("liked", "checkbox")), "True");
    assert.equal(groupLabel(value("false"), tag("liked", "checkbox")), "False");
    assert.equal(
        groupLabel(value("true"), { kind: "metadata", key: "explicit" }),
        "Explicit",
    );
    assert.equal(
        groupLabel(value("225000"), { kind: "metadata", key: "duration" }),
        "3:45",
    );
    assert.match(
        groupLabel(
            value("2024-03-01"),
            tag("Last Played", "datetime", "activity"),
        ),
        /2024/,
    );
});

test("durations read as minutes and seconds", () => {
    assert.equal(formatDuration(59_400), "0:59");
    assert.equal(formatDuration(3_725_000), "1:02:05");
});

test("release dates go over as days", () => {
    assert.equal(releaseDay(Date.UTC(1984, 5, 25)), "1984-06-25");
    assert.equal(releaseDay(undefined), undefined);
});

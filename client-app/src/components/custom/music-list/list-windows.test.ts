import assert from "node:assert/strict";
import test from "node:test";

import type { MusicItem } from "@apple-musickit";

import {
    GROUP_WINDOW,
    groupsToGrow,
    reuseSections,
    sectionRows,
    tagIdsToRead,
} from "./list-windows.ts";
import type { MusicListSection } from "./types.ts";

const track = (id: string) => ({ id }) as MusicItem;
const tracks = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => track(`${prefix}${index}`));
const section = (
    key: string,
    songs: MusicItem[],
    overrides: Partial<MusicListSection> = {},
): MusicListSection => ({
    key,
    label: key,
    count: songs.length,
    expanded: true,
    tracks: songs,
    isLoading: false,
    ...overrides,
});
const defaultLimit = () => GROUP_WINDOW;
const songIdOf = (item: MusicItem) => item.id;

test("an open group shows only its first window of songs", () => {
    const rows = sectionRows(
        [section("a", tracks("a", 1000)), section("b", tracks("b", 3))],
        defaultLimit,
    );
    assert.equal(rows.length, 1 + GROUP_WINDOW + 1 + 3);
    assert.equal(rows[0].type, "header");
    assert.equal(rows[GROUP_WINDOW + 1].type, "header");
});

test("a closed group is its header alone, and an empty loading one a placeholder", () => {
    const rows = sectionRows(
        [
            section("a", tracks("a", 10), { expanded: false }),
            section("b", [], { isLoading: true, count: 5 }),
        ],
        defaultLimit,
    );
    assert.deepEqual(
        rows.map((row) => row.type),
        ["header", "header", "loading"],
    );
});

test("a group grows once the screen nears the end of what it shows", () => {
    const rows = sectionRows([section("a", tracks("a", 1000))], defaultLimit);
    const count = () => 1000;
    // rows 1 to 10 on screen: the window ends at row 50, far below
    assert.deepEqual(groupsToGrow(rows, 0, 10, defaultLimit, count), []);
    // rows 25 to 35: the last shown song is within reach
    assert.deepEqual(groupsToGrow(rows, 25, 35, defaultLimit, count), ["a"]);
});

test("a group showing every song it holds never grows", () => {
    const rows = sectionRows([section("a", tracks("a", 40))], defaultLimit);
    assert.deepEqual(
        groupsToGrow(rows, 20, 40, defaultLimit, () => 40),
        [],
    );
});

test("a group still loading grows by the songs it will have", () => {
    const rows = sectionRows(
        [section("a", tracks("a", 45), { count: 300 })],
        defaultLimit,
    );
    assert.deepEqual(
        groupsToGrow(rows, 30, 45, defaultLimit, () => 300),
        ["a"],
    );
});

test("tags are read for the rows near the screen, a step ahead", () => {
    const rows = sectionRows([section("a", tracks("a", 500))], () => 500);
    const ids = tagIdsToRead(rows, 0, 10, new Set(), songIdOf);
    assert.ok(ids);
    assert.equal(ids[0], "a0");
    // rows 1 to 70 are songs a0 to a69
    assert.equal(ids.length, 70);
});

test("nothing is read while the rows near the screen are covered", () => {
    const rows = sectionRows([section("a", tracks("a", 500))], () => 500);
    const read = new Set(tracks("a", 70).map(songIdOf));
    assert.equal(tagIdsToRead(rows, 20, 30, read, songIdOf), null);
    // scrolled on, only the songs not read yet
    const more = tagIdsToRead(rows, 45, 55, read, songIdOf);
    assert.ok(more);
    assert.equal(more[0], "a70");
    assert.ok(!more.includes("a69"));
});

test("groups that did not change are kept as they were", () => {
    const songs = tracks("a", 3);
    const previous = [
        section("a", songs),
        section("b", [], { expanded: false }),
    ];
    const same = [
        section("a", [...songs]),
        section("b", [], { expanded: false }),
    ];
    assert.equal(reuseSections(previous, same), previous);

    const grown = [
        section("a", [...songs, track("a3")]),
        section("b", [], { expanded: false }),
    ];
    const merged = reuseSections(previous, grown);
    assert.notEqual(merged, previous);
    assert.notEqual(merged?.[0], previous[0]);
    assert.equal(merged?.[1], previous[1]);
});

test("a group leaves out explicit songs when they are hidden", () => {
    const songs = [track("a"), { ...track("b"), isExplicit: true }, track("c")];
    const ids = (hide: boolean) =>
        sectionRows([section("g", songs)], defaultLimit, hide).flatMap((row) =>
            row.type === "track" ? [row.track.id] : [],
        );
    assert.deepEqual(ids(true), ["a", "c"]);
    assert.deepEqual(ids(false), ["a", "b", "c"]);
});

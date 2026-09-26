import assert from "node:assert/strict";
import test from "node:test";

import type { AppliedTag, Tag } from "../../../lib/types.ts";
import { sortMusicListTags } from "./sort-tags.ts";

const local = (id: number, name: string): AppliedTag => ({
    id,
    name,
    color: "#000000",
    type: "basic",
    value: null,
});
const shared = (id: number, name: string): Tag => ({
    id,
    name,
    color: "#ffffff",
    type: "basic",
});

test("puts relevant names first in the supplied order", () => {
    const tags = [local(1, "metal"), local(2, "indie"), local(3, "rock")];

    assert.deepEqual(
        sortMusicListTags(tags, [], ["ROCK", " indie "], {
            1: { count: 200 },
            2: { count: 2 },
            3: { count: 1 },
        }).map(({ tag }) => tag.name),
        ["rock", "indie", "metal"],
    );
});

test("uses library count then stable name and id tie breakers", () => {
    const tags = [
        local(4, "rock"),
        local(3, "ambient"),
        local(2, "ambient"),
        local(1, "metal"),
    ];

    assert.deepEqual(
        sortMusicListTags(tags, [], [], {
            1: { count: 2 },
            2: { count: 2 },
            3: { count: 2 },
            4: { count: 200 },
        }).map(({ tag }) => tag.id),
        [4, 2, 3, 1],
    );
});

test("ranks local and shared tags together without mutating inputs", () => {
    const tags = [local(1, "rock")];
    const defaults = [shared(10, "indie"), shared(11, "ambient")];

    const ordered = sortMusicListTags(tags, defaults, ["indie"], {
        1: { count: 20 },
    });

    assert.deepEqual(
        ordered.map(({ source, tag }) => `${source}:${tag.name}`),
        ["default:indie", "local:rock", "default:ambient"],
    );
    assert.deepEqual(
        tags.map((tag) => tag.name),
        ["rock"],
    );
    assert.deepEqual(
        defaults.map((tag) => tag.name),
        ["indie", "ambient"],
    );
});

test("deduplicates relevant priorities by normalized name", () => {
    const tags = [local(1, "rock"), local(2, "indie")];

    assert.deepEqual(
        sortMusicListTags(tags, [], ["rock", " ROCK ", "indie"]).map(
            ({ tag }) => tag.name,
        ),
        ["rock", "indie"],
    );
});

import assert from "node:assert/strict";
import test from "node:test";

import { matchesEndpoint } from "./api-endpoints.ts";

const key = {
    keyType: "api-data",
    path: "/songs/local-tags",
    params: { song_id: "song-a", include: "all" },
};

test("endpoint params match as a subset of the cached params", () => {
    assert.equal(
        matchesEndpoint(key, {
            path: "/songs/local-tags",
            params: { song_id: "song-a" },
        }),
        true,
    );
    assert.equal(
        matchesEndpoint(key, {
            path: "/songs/local-tags",
            params: { song_id: "song-b" },
        }),
        false,
    );
});

test("an endpoint without params covers every cached read of that path", () => {
    assert.equal(matchesEndpoint(key, { path: "/songs/local-tags" }), true);
    assert.equal(
        matchesEndpoint(
            { keyType: "api-data", path: "/tags", params: { tag_id: 3 } },
            { path: "/tags" },
        ),
        true,
    );
    assert.equal(
        matchesEndpoint(
            { keyType: "api-data", path: "/tags" },
            { path: "/tags" },
        ),
        true,
    );
});

test("exact params distinguish a collection read from one item", () => {
    assert.equal(
        matchesEndpoint(
            { keyType: "api-data", path: "/tags" },
            { path: "/tags", exactParams: true },
        ),
        true,
    );
    assert.equal(
        matchesEndpoint(
            { keyType: "api-data", path: "/tags", params: { tag_id: 3 } },
            { path: "/tags", exactParams: true },
        ),
        false,
    );
    assert.equal(
        matchesEndpoint(
            { keyType: "api-data", path: "/tags", params: { tag_id: 3 } },
            {
                path: "/tags",
                params: { tag_id: 3 },
                exactParams: true,
            },
        ),
        true,
    );
});

test("a batched endpoint can match only keys containing one item", () => {
    const batchKey = {
        keyType: "api-data",
        path: "/songs/local-tags/batch",
        items: ["song-a", "song-b"],
    };
    assert.equal(
        matchesEndpoint(batchKey, {
            path: "/songs/local-tags/batch",
            item: "song-b",
        }),
        true,
    );
    assert.equal(
        matchesEndpoint(batchKey, {
            path: "/songs/local-tags/batch",
            item: "song-c",
        }),
        false,
    );
});

test("non api-data keys and other paths never match", () => {
    assert.equal(matchesEndpoint(key, { path: "/tags" }), false);
    assert.equal(
        matchesEndpoint(
            { path: "/songs/local-tags" },
            { path: "/songs/local-tags" },
        ),
        false,
    );
    assert.equal(
        matchesEndpoint("/songs/local-tags", { path: "/songs/local-tags" }),
        false,
    );
    assert.equal(matchesEndpoint(null, { path: "/songs/local-tags" }), false);
});

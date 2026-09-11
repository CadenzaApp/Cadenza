import assert from "node:assert/strict";
import test from "node:test";

import { matchesEndpoint } from "./api-endpoints.ts";

const key = {
    keyType: "api-data",
    path: "/songs/tags",
    params: { song_id: "song-a", include: "all" },
};

test("endpoint params match as a subset of the cached params", () => {
    assert.equal(
        matchesEndpoint(key, {
            path: "/songs/tags",
            params: { song_id: "song-a" },
        }),
        true,
    );
    assert.equal(
        matchesEndpoint(key, {
            path: "/songs/tags",
            params: { song_id: "song-b" },
        }),
        false,
    );
});

test("an endpoint without params covers every cached read of that path", () => {
    assert.equal(matchesEndpoint(key, { path: "/songs/tags" }), true);
    assert.equal(
        matchesEndpoint(
            { keyType: "api-data", path: "/tags", params: { tag_id: 3 } },
            { path: "/tags" },
        ),
        true,
    );
    assert.equal(
        matchesEndpoint({ keyType: "api-data", path: "/tags" }, { path: "/tags" }),
        true,
    );
});

test("non api-data keys and other paths never match", () => {
    assert.equal(matchesEndpoint(key, { path: "/tags" }), false);
    assert.equal(
        matchesEndpoint({ path: "/songs/tags" }, { path: "/songs/tags" }),
        false,
    );
    assert.equal(matchesEndpoint("/songs/tags", { path: "/songs/tags" }), false);
    assert.equal(matchesEndpoint(null, { path: "/songs/tags" }), false);
});

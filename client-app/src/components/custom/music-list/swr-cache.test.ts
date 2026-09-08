import assert from "node:assert/strict";
import test from "node:test";

import { matchesEndpoint } from "../../../lib/swr-cache.ts";

test("cache invalidation respects endpoint parameters", () => {
    const key = {
        path: "/songs/tags",
        params: { song_id: "song-a", include: "all" },
    };

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
    assert.equal(
        matchesEndpoint(key, { path: "/songs/tags", params: "*" }),
        true,
    );
    assert.equal(matchesEndpoint(key, { path: "/tags" }), false);
});

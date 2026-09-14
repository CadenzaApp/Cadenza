import assert from "node:assert/strict";
import test from "node:test";

import {
    initializeSongs,
    SONG_INIT_BATCH_SIZE,
    SONG_INIT_PAGE_SIZE,
} from "./song-init-job.ts";
import type {
    SongInitDeps,
    SongInitItem,
    SongInitPage,
} from "./song-init-job.ts";

function song(id: string, fields: Partial<SongInitItem> = {}): SongInitItem {
    return { id, title: `Song ${id}`, artistName: "Artist", ...fields };
}

/** Serves `items` a page at a time, the way a paged MusicKit read does. */
function paged(items: SongInitItem[]) {
    return async ({
        limit,
        offset,
    }: {
        limit: number;
        offset: number;
    }): Promise<SongInitPage> => ({
        items: items.slice(offset, offset + limit),
        hasNextPage: offset + limit < items.length,
        nextOffset: offset + limit,
    });
}

/**
 * A fake MusicKit and backend. `playlists` is keyed by library id. A song in
 * `tagless` has no tags until `setDefaultTags` gives it some.
 */
function fakeDeps({
    library = [],
    playlists = {},
    tagless = [],
}: {
    library?: SongInitItem[];
    playlists?: Record<string, SongInitItem[]>;
    tagless?: string[];
}) {
    const songsWithoutTags = new Set(tagless);
    const calls = {
        untagged: [] as string[][],
        defaultTags: [] as { song_id: string; desc: string }[][],
        initialized: 0,
        counts: [] as number[],
    };

    const deps: SongInitDeps = {
        getLibrarySongs: paged(library),
        // a playlist's plain id is a catalog id, so only its library id finds its songs
        getUserPlaylists: paged(
            Object.keys(playlists).map((libraryId) =>
                song(`catalog-${libraryId}`, { libraryId }),
            ),
        ),
        getPlaylistSongs: (playlistId, options) =>
            paged(playlists[playlistId] ?? [])(options),
        getUntaggedSongs: async ({ song_ids }) => {
            calls.untagged.push(song_ids);
            return song_ids.filter((songId) => songsWithoutTags.has(songId));
        },
        setDefaultTags: async (songs) => {
            calls.defaultTags.push(songs);
            for (const { song_id } of songs) songsWithoutTags.delete(song_id);
        },
        onSongsInitialized: () => {
            calls.initialized += 1;
        },
        onUninitializedCountChange: (count) => {
            calls.counts.push(count);
        },
        isCancelled: () => false,
    };

    return { deps, calls };
}

test("asks about the library and then every playlist, once per song", async () => {
    const { deps, calls } = fakeDeps({
        library: [song("a"), song("library-b", { catalogId: "b" })],
        playlists: {
            p1: [song("b"), song("c")],
            p2: [song("c"), song("d")],
        },
    });

    await initializeSongs(deps);

    // songs go by catalog id, and a song an earlier page had is not asked about again
    assert.deepEqual(calls.untagged, [["a", "b"], ["c"], ["d"]]);
    assert.deepEqual(calls.defaultTags, []);
    assert.deepEqual(calls.counts, []);
    assert.equal(calls.initialized, 1);
});

test("generates tags for uninitialized songs in batches, then reads each batch back", async () => {
    const library = Array.from({ length: SONG_INIT_PAGE_SIZE + 50 }, (_, i) =>
        song(`s${i}`),
    );
    const uninitializedCount = SONG_INIT_BATCH_SIZE + 20;
    const { deps, calls } = fakeDeps({
        library,
        tagless: library.slice(0, uninitializedCount).map((item) => item.id),
    });

    await initializeSongs(deps);

    // two batches, each described for generation and then read back
    assert.deepEqual(
        calls.defaultTags.map((batch) => batch.length),
        [SONG_INIT_BATCH_SIZE, 20],
    );
    assert.deepEqual(calls.defaultTags[0][0], {
        song_id: "s0",
        desc: "Song s0 by Artist",
    });
    assert.deepEqual(
        calls.untagged.slice(-2),
        calls.defaultTags.map((batch) => batch.map((item) => item.song_id)),
    );

    // the count climbs while searching, then drops a batch at a time
    assert.equal(Math.max(...calls.counts), uninitializedCount);
    assert.deepEqual(calls.counts.slice(-2), [20, 0]);
    assert.equal(calls.initialized, 3);
});

test("drops a batch whose generation fails, so the count still reaches zero", async (t) => {
    const logged = t.mock.method(console, "error", () => {});
    const { deps, calls } = fakeDeps({
        library: [song("a"), song("b")],
        tagless: ["a"],
    });
    deps.setDefaultTags = async () => {
        throw new Error("generation failed");
    };

    await initializeSongs(deps);

    // the batch is not read back, and it does not keep counting
    assert.deepEqual(calls.untagged, [["a", "b"]]);
    assert.deepEqual(calls.counts, [1, 0]);
    assert.equal(calls.initialized, 1);
    assert.equal(logged.mock.callCount(), 1);
});

test("skips a playlist that fails to read and keeps searching", async (t) => {
    const logged = t.mock.method(console, "error", () => {});
    const { deps, calls } = fakeDeps({
        playlists: { p1: [song("a")], p2: [song("b")] },
    });

    // the first playlist throws, the second still reads
    const getPlaylistSongs = deps.getPlaylistSongs;
    deps.getPlaylistSongs = async (playlistId, options) => {
        if (playlistId === "p1") throw new Error("playlist unavailable");
        return getPlaylistSongs(playlistId, options);
    };

    await initializeSongs(deps);

    assert.deepEqual(calls.untagged, [["b"]]);
    assert.equal(logged.mock.callCount(), 1);
});

test("stops before generating tags once cancelled", async () => {
    const { deps, calls } = fakeDeps({ library: [song("a")], tagless: ["a"] });
    // cancel as soon as the search has asked about anything
    deps.isCancelled = () => calls.untagged.length > 0;

    await initializeSongs(deps);

    assert.deepEqual(calls.defaultTags, []);
    assert.equal(calls.initialized, 0);
});

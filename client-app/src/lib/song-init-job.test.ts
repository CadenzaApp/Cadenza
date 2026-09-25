import assert from "node:assert/strict";
import test from "node:test";

import {
    PLAYLIST_CONCURRENCY,
    SONG_INIT_PAGE_SIZE,
    SONG_SYNC_BATCH_SIZE,
    syncLibrary,
} from "./song-init-job.ts";
import type {
    EditUserSongsPayload,
    InitializedSongsStore,
    SongInitItem,
    SongInitPage,
    SongSyncDeps,
} from "./song-init-job.ts";

function song(id: string, fields: Partial<SongInitItem> = {}): SongInitItem {
    return { id, ...fields };
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

/** `initialized-songs-db.ts` without the SQLite, so a run can be asserted on. */
function fakeStore(initial: Record<string, number> = {}) {
    const rows = new Map<string, number>(Object.entries(initial));

    const store: InitializedSongsStore = {
        async markSeen(songIds, timestamp) {
            const unknown: string[] = [];
            for (const songId of songIds) {
                if (rows.has(songId)) rows.set(songId, timestamp);
                else unknown.push(songId);
            }
            return unknown;
        },
        async getStaleSongIds(before) {
            return [...rows]
                .filter(([, stamp]) => stamp < before)
                .map(([songId]) => songId);
        },
        async recordSynced(added, removed, timestamp) {
            for (const songId of added) rows.set(songId, timestamp);
            for (const songId of removed) rows.delete(songId);
        },
    };

    return { store, rows };
}

/**
 * A fake MusicKit and backend. `playlists` is keyed by library id. `failing`
 * names a source whose read throws, which is what an incomplete walk looks
 * like.
 */
function fakeDeps({
    library = [],
    playlists = {},
    store = fakeStore().store,
    failing,
    failPatchAfter = Infinity,
    now = 1000,
}: {
    library?: SongInitItem[];
    playlists?: Record<string, SongInitItem[]>;
    store?: InitializedSongsStore;
    failing?: "library" | "playlists";
    failPatchAfter?: number;
    now?: number;
}) {
    const calls = { patches: [] as EditUserSongsPayload[] };

    const deps: SongSyncDeps = {
        getLibrarySongs: async (options) => {
            if (failing === "library") throw new Error("library read failed");
            return paged(library)(options);
        },
        // a playlist's plain id is a catalog id, so only its library id finds its songs
        getUserPlaylists: async (options) => {
            if (failing === "playlists")
                throw new Error("playlist read failed");
            return paged(
                Object.keys(playlists).map((libraryId) =>
                    song(`catalog-${libraryId}`, { libraryId }),
                ),
            )(options);
        },
        getPlaylistSongs: (playlistId, options) =>
            paged(playlists[playlistId] ?? [])(options),
        store,
        editUserSongs: async (payload) => {
            if (calls.patches.length >= failPatchAfter) {
                throw new Error("patch failed");
            }
            calls.patches.push(payload);
        },
        now: () => now,
        isCancelled: () => false,
    };

    return { deps, calls };
}

test("a first run sends the whole library as adds", async () => {
    const { store, rows } = fakeStore();
    const { deps, calls } = fakeDeps({
        library: [song("a"), song("b")],
        store,
    });

    const result = await syncLibrary(deps);

    assert.deepEqual(calls.patches, [{ add: ["a", "b"], remove: [] }]);
    assert.deepEqual(result, { added: 2, removed: 0, complete: true });
    // the store now says what the backend holds, stamped with the run
    assert.deepEqual(
        [...rows],
        [
            ["a", 1000],
            ["b", 1000],
        ],
    );
});

test("a run over an unchanged library sends nothing", async () => {
    const { store, rows } = fakeStore({ a: 1, b: 1 });
    const { deps, calls } = fakeDeps({
        library: [song("a"), song("b")],
        store,
        now: 5000,
    });

    const result = await syncLibrary(deps);

    assert.deepEqual(calls.patches, []);
    assert.deepEqual(result, { added: 0, removed: 0, complete: true });
    // stamped forward all the same, which is what keeps them out of the sweep
    assert.deepEqual(
        [...rows],
        [
            ["a", 5000],
            ["b", 5000],
        ],
    );
});

test("a song Apple Music no longer has is removed", async () => {
    const { store, rows } = fakeStore({ kept: 1, gone: 1 });
    const { deps, calls } = fakeDeps({
        library: [song("kept"), song("new")],
        store,
    });

    const result = await syncLibrary(deps);

    // removes go out before adds, so a shrunk library stops matching first
    assert.deepEqual(calls.patches, [
        { add: [], remove: ["gone"] },
        { add: ["new"], remove: [] },
    ]);
    assert.deepEqual(result, { added: 1, removed: 1, complete: true });
    assert.deepEqual(
        [...rows].map(([songId]) => songId),
        ["kept", "new"],
    );
});

test("the catalog id is what gets sent, when the song has one", async () => {
    const { deps, calls } = fakeDeps({
        library: [song("i.library-only"), song("i.other", { catalogId: "42" })],
    });

    await syncLibrary(deps);

    assert.deepEqual(calls.patches, [
        { add: ["i.library-only", "42"], remove: [] },
    ]);
});

test("playlist songs outside the library are part of it too", async () => {
    const { deps, calls } = fakeDeps({
        library: [song("in-library")],
        playlists: { "p.1": [song("in-library"), song("playlist-only")] },
    });

    await syncLibrary(deps);

    // the playlist itself is not a song, and the shared song is sent once
    assert.deepEqual(calls.patches, [
        { add: ["in-library", "playlist-only"], remove: [] },
    ]);
});

/**
 * The sweep reads "not stamped this run" as "gone from Apple Music". A read
 * that failed leaves songs unstamped for the other reason, so acting on it
 * would empty the backend's library down to whatever did get read.
 */
test("a walk that failed to read a source skips the removals", async () => {
    const { store, rows } = fakeStore({ unread: 1 });
    const { deps, calls } = fakeDeps({
        library: [song("a")],
        failing: "playlists",
        store,
    });

    const result = await syncLibrary(deps);

    assert.deepEqual(calls.patches, [{ add: ["a"], remove: [] }]);
    assert.equal(result.complete, false);
    assert.equal(result.removed, 0);
    assert.ok(rows.has("unread"), "the unread song is left alone");
});

test("adds go out in batches under the backend's cap", async () => {
    const library = Array.from(
        { length: SONG_SYNC_BATCH_SIZE + 1 },
        (_, index) => song(`song-${index}`),
    );
    const { store, rows } = fakeStore();
    const { deps, calls } = fakeDeps({ library, store });

    await syncLibrary(deps);

    assert.equal(calls.patches.length, 2);
    assert.equal(calls.patches[0].add.length, SONG_SYNC_BATCH_SIZE);
    assert.equal(calls.patches[1].add.length, 1);
    assert.equal(rows.size, library.length);
});

test("a library longer than a page is read to the end", async () => {
    const library = Array.from(
        { length: SONG_INIT_PAGE_SIZE + 5 },
        (_, index) => song(`song-${index}`),
    );
    const { deps, calls } = fakeDeps({ library });

    await syncLibrary(deps);

    assert.equal(calls.patches[0].add.length, library.length);
});

/**
 * The store has to track the backend rather than the walk, or a run that died
 * between two batches would leave songs the backend never heard about marked
 * as sent.
 */
test("a failed batch leaves the rest of the run for next time", async () => {
    const library = Array.from(
        { length: SONG_SYNC_BATCH_SIZE * 2 },
        (_, index) => song(`song-${index}`),
    );
    const { store, rows } = fakeStore();
    const { deps } = fakeDeps({ library, store, failPatchAfter: 1 });

    await assert.rejects(() => syncLibrary(deps));

    // only the batch the backend took is recorded
    assert.equal(rows.size, SONG_SYNC_BATCH_SIZE);
});

test("a cancelled run reports itself incomplete and stops sending", async () => {
    const { store, rows } = fakeStore({ gone: 1 });
    const { deps, calls } = fakeDeps({ library: [song("a")], store });
    const cancelled = { ...deps, isCancelled: () => true };

    const result = await syncLibrary(cancelled);

    assert.deepEqual(calls.patches, []);
    assert.deepEqual(result, { added: 0, removed: 0, complete: false });
    assert.ok(rows.has("gone"), "nothing is swept on a cancelled run");
});

/** One playlist per id, each holding a song only it has. */
function manyPlaylists(count: number) {
    const playlists: Record<string, SongInitItem[]> = {};
    for (let index = 0; index < count; index += 1) {
        playlists[`p.${index}`] = [song(`playlist-song-${index}`)];
    }
    return playlists;
}

const tick = (ms: number) =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

test("the library walk and the playlist walk overlap", async () => {
    const { deps } = fakeDeps({
        library: [song("a")],
        playlists: { "p.1": [song("b")] },
    });

    let libraryDone = false;
    let startedBeforeLibraryDone = false;
    const overlapping: SongSyncDeps = {
        ...deps,
        getLibrarySongs: async (options) => {
            try {
                await tick(10);
                return await deps.getLibrarySongs(options);
            } finally {
                libraryDone = true;
            }
        },
        getUserPlaylists: async (options) => {
            if (!libraryDone) startedBeforeLibraryDone = true;
            return deps.getUserPlaylists(options);
        },
    };

    await syncLibrary(overlapping);

    assert.ok(
        startedBeforeLibraryDone,
        "the playlist index should not wait on the library walk",
    );
});

test("playlists are read in parallel, up to the pool's width", async () => {
    const { deps } = fakeDeps({ playlists: manyPlaylists(PLAYLIST_CONCURRENCY * 2) });

    let inFlight = 0;
    let peak = 0;
    const tracked: SongSyncDeps = {
        ...deps,
        getPlaylistSongs: async (playlistId, options) => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            try {
                await tick(5);
                return await deps.getPlaylistSongs(playlistId, options);
            } finally {
                inFlight -= 1;
            }
        },
    };

    await syncLibrary(tracked);

    assert.ok(peak > 1, "playlists should overlap rather than run one by one");
    assert.ok(
        peak <= PLAYLIST_CONCURRENCY,
        `${peak} playlists were in flight, over the pool's ${PLAYLIST_CONCURRENCY}`,
    );
});

/**
 * `markSeen` reads then writes inside one transaction on a single shared
 * connection, so the parallel walks above have to queue behind each other.
 */
test("store writes stay serialized while the walks run in parallel", async () => {
    const { store } = fakeStore();
    let inFlight = 0;
    let overlapped = false;

    const watched: InitializedSongsStore = {
        ...store,
        async markSeen(songIds, timestamp) {
            inFlight += 1;
            if (inFlight > 1) overlapped = true;
            try {
                await tick(1);
                return await store.markSeen(songIds, timestamp);
            } finally {
                inFlight -= 1;
            }
        },
    };

    const { deps } = fakeDeps({
        library: [song("a")],
        playlists: manyPlaylists(PLAYLIST_CONCURRENCY * 2),
        store: watched,
    });

    await syncLibrary(deps);

    assert.equal(overlapped, false, "markSeen ran concurrently");
});

test("every playlist is walked exactly once under the pool", async () => {
    const { deps, calls } = fakeDeps({
        playlists: manyPlaylists(PLAYLIST_CONCURRENCY * 2),
    });

    const visited: string[] = [];
    const tracked: SongSyncDeps = {
        ...deps,
        getPlaylistSongs: async (playlistId, options) => {
            if (options.offset === 0) visited.push(playlistId);
            return deps.getPlaylistSongs(playlistId, options);
        },
    };

    await syncLibrary(tracked);

    assert.deepEqual(
        [...visited].sort(),
        Object.keys(manyPlaylists(PLAYLIST_CONCURRENCY * 2)).sort(),
    );
    assert.equal(calls.patches[0].add.length, PLAYLIST_CONCURRENCY * 2);
});

test("a source whose offset does not advance stops instead of looping", async () => {
    const { store, rows } = fakeStore({ gone: 1 });
    const { deps, calls } = fakeDeps({ store });
    let reads = 0;

    // what a stuck native pager looks like: a full page every time, always
    // pointing back at the same next offset
    deps.getLibrarySongs = async () => {
        reads += 1;
        return { items: [song("a")], hasNextPage: true, nextOffset: 0 };
    };

    const result = await syncLibrary(deps);

    assert.equal(reads, 1);
    // the walk never saw the whole library, so nothing is treated as deleted
    assert.equal(result.complete, false);
    assert.deepEqual(calls.patches, [{ add: ["a"], remove: [] }]);
    assert.ok(rows.has("gone"));
});

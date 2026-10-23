import assert from "node:assert/strict";
import test from "node:test";

import {
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
 * A fake MusicKit and backend. `failing` makes the library read throw, which
 * is what an incomplete walk looks like.
 */
function fakeDeps({
    library = [],
    store = fakeStore().store,
    failing,
    failPatchAfter = Infinity,
    now = 1000,
}: {
    library?: SongInitItem[];
    store?: InitializedSongsStore;
    failing?: boolean;
    failPatchAfter?: number;
    now?: number;
}) {
    const calls = { patches: [] as EditUserSongsPayload[] };

    const deps: SongSyncDeps = {
        getLibrarySongs: async (options) => {
            if (failing) throw new Error("library read failed");
            return paged(library)(options);
        },
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

/**
 * The sweep reads "not stamped this run" as "gone from Apple Music". A read
 * that failed leaves songs unstamped for the other reason, so acting on it
 * would empty the backend's library down to whatever did get read.
 */
test("a walk that failed to read the library skips the removals", async () => {
    const { store, rows } = fakeStore({ unread: 1 });
    const { deps, calls } = fakeDeps({ failing: true, store });

    const result = await syncLibrary(deps);

    assert.deepEqual(calls.patches, []);
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

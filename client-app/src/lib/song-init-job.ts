/** Prefix on every line the job logs, so one run is greppable out of the console. */
export const LOG_TAG = "[library-sync]";

/** MusicKit returns at most 100 library items a page. */
export const SONG_INIT_PAGE_SIZE = 100;

/**
 * Songs per `PATCH /songs`. The backend counts `add` and `remove` together
 * against one 200 song cap, so a batch holds at most this many of both.
 */
export const SONG_SYNC_BATCH_SIZE = 200;

/** The parts of a MusicKit `MusicItem` the job reads. */
export type SongInitItem = {
    id: string;
    catalogId?: string;
    libraryId?: string;
};

/** One page of a paged MusicKit read. `LibraryResult` fits it. */
export type SongInitPage = {
    items: SongInitItem[];
    hasNextPage: boolean;
    nextOffset?: number;
};

type PageOptions = { limit: number; offset: number };

/** The `PATCH /songs` body. Both lists are optional to the backend. */
export type EditUserSongsPayload = {
    add: string[];
    remove: string[];
};

/**
 * The device's record of what the backend's `user_songs` holds, for one
 * account. `initialized-songs-db.ts` backs it with SQLite; the tests use a
 * plain map.
 */
export type InitializedSongsStore = {
    /**
     * Moves the stamp on every one of `songIds` the store already holds up to
     * `timestamp`, and returns the ids it does not hold. Those are the songs
     * the backend has never been told about.
     */
    markSeen: (songIds: string[], timestamp: number) => Promise<string[]>;
    /**
     * Ids still stamped older than `before`, meaning this run did not find them
     * in Apple Music. Only meaningful after a walk that covered every source.
     */
    getStaleSongIds: (before: number) => Promise<string[]>;
    /**
     * Applies what a `PATCH /songs` just did: `added` is stamped with
     * `timestamp`, `removed` is dropped.
     */
    recordSynced: (
        added: string[],
        removed: string[],
        timestamp: number,
    ) => Promise<void>;
};

/** What the job reads from and writes to. `song-init.tsx` wires in MusicKit and the backend. */
export type SongSyncDeps = {
    getLibrarySongs: (options: PageOptions) => Promise<SongInitPage>;
    getUserPlaylists: (options: PageOptions) => Promise<SongInitPage>;
    getPlaylistSongs: (
        playlistId: string,
        options: PageOptions,
    ) => Promise<SongInitPage>;
    store: InitializedSongsStore;
    /** `PATCH /songs`. */
    editUserSongs: (payload: EditUserSongsPayload) => Promise<unknown>;
    /** Epoch milliseconds. Injected so a test can pin the run's stamp. */
    now: () => number;
    isCancelled: () => boolean;
};

/** What one run did, for the caller to log or report. */
export type SongSyncResult = {
    added: number;
    removed: number;
    /**
     * False when a source failed to read, so the walk did not see the whole
     * library. The delete sweep is skipped in that case.
     */
    complete: boolean;
};

/**
 * Brings the backend's copy of the user's library in step with Apple Music.
 *
 * The run stamps itself with one timestamp. Walking Apple Music moves that
 * stamp onto every song the store already holds and collects the ones it does
 * not, which are the adds. Anything left stamped older than the run is a song
 * Apple Music no longer has, which are the removes. Both go out through
 * `PATCH /songs` in batches, and the store is updated after each one, so a run
 * that dies halfway leaves the rest for the next run rather than redoing it.
 *
 * A song is keyed by its catalog id when it has one, the same id tags and
 * queries use.
 */
export async function syncLibrary(deps: SongSyncDeps): Promise<SongSyncResult> {
    const startedAt = deps.now();

    const { songIdsToAdd, complete } = await findSongsToAdd(deps, startedAt);
    if (deps.isCancelled()) {
        return { added: 0, removed: 0, complete: false };
    }

    // a walk that missed a source cannot tell a deleted song from an unread
    // one, and acting on that would strip the library down to what it did read
    const songIdsToRemove = complete
        ? await deps.store.getStaleSongIds(startedAt)
        : [];

    const synced = await sendInBatches(
        deps,
        songIdsToAdd,
        songIdsToRemove,
        startedAt,
    );

    return { ...synced, complete };
}

/**
 * Walks the library and then every library playlist, stamping songs the store
 * already holds and collecting the rest. A source that fails to read is logged
 * and skipped, and makes the walk incomplete.
 */
async function findSongsToAdd(deps: SongSyncDeps, startedAt: number) {
    const songIdsToAdd: string[] = [];
    const seen = new Set<string>();
    let complete = true;

    const onPage = async (songs: SongInitItem[]) => {
        // tags key on the catalog id when there is one, same as everywhere
        // else. a song an earlier page already had is skipped
        const unseen: string[] = [];
        for (const song of songs) {
            const songId = song.catalogId ?? song.id;
            if (seen.has(songId)) continue;
            seen.add(songId);
            unseen.push(songId);
        }
        if (unseen.length === 0 || deps.isCancelled()) return 0;

        const newSongIds = await deps.store.markSeen(unseen, startedAt);
        songIdsToAdd.push(...newSongIds);
        return newSongIds.length;
    };

    const trySource = async (source: string, walk: () => Promise<void>) => {
        try {
            await walk();
        } catch (error) {
            complete = false;
            console.error(
                `${LOG_TAG} reading ${source} from Apple Music failed:`,
                error,
            );
        }
    };

    // the library first
    await trySource("library songs", () =>
        forEachPage(
            "library songs",
            deps.getLibrarySongs,
            onPage,
            deps.isCancelled,
        ),
    );

    // then each playlist, which can hold songs that are not in the library
    await trySource("playlists", () =>
        forEachPage(
            "playlists",
            deps.getUserPlaylists,
            async (playlists) => {
                for (const playlist of playlists) {
                    // playlists are addressed by their library id
                    const playlistId = playlist.libraryId ?? playlist.id;
                    await trySource(`playlist ${playlistId}`, () =>
                        forEachPage(
                            `playlist ${playlistId}`,
                            (options) =>
                                deps.getPlaylistSongs(playlistId, options),
                            onPage,
                            deps.isCancelled,
                        ),
                    );
                }
            },
            deps.isCancelled,
        ),
    );

    // a cancelled walk stopped early, so it says nothing about what is gone
    if (deps.isCancelled()) complete = false;

    return { songIdsToAdd, complete };
}

/**
 * Sends the adds and the removes, at most `SONG_SYNC_BATCH_SIZE` songs a
 * request, and records each batch locally once the backend has taken it.
 *
 * Removes go first, so a library that shrank stops matching queries before the
 * slower add pass runs. A batch that fails stops the pass: the store still
 * describes what the backend holds, so the next run picks the rest up.
 */
async function sendInBatches(
    deps: SongSyncDeps,
    songIdsToAdd: string[],
    songIdsToRemove: string[],
    timestamp: number,
) {
    let added = 0;
    let removed = 0;

    // materialized so a line can say which batch of how many is going out
    const removeBatches = [...batched(songIdsToRemove)];
    const addBatches = [...batched(songIdsToAdd)];

    const send = async (
        batch: string[],
        kind: "add" | "remove",
        index: number,
        total: number,
    ) => {
        const payload: EditUserSongsPayload = {
            add: kind === "add" ? batch : [],
            remove: kind === "remove" ? batch : [],
        };
        // logged before the request, so a batch that hangs or throws still
        // shows up as one that was attempted
        console.log(
            `${LOG_TAG} PATCH /songs: ${kind} ${batch.length} songs ` +
                `(batch ${index + 1} of ${total})`,
        );
        await deps.editUserSongs(payload);
        await deps.store.recordSynced(payload.add, payload.remove, timestamp);
    };

    try {
        for (const [index, batch] of removeBatches.entries()) {
            if (deps.isCancelled()) break;
            await send(batch, "remove", index, removeBatches.length);
            removed += batch.length;
        }
        for (const [index, batch] of addBatches.entries()) {
            if (deps.isCancelled()) break;
            await send(batch, "add", index, addBatches.length);
            added += batch.length;
        }
    } catch (error) {
        console.error(
            `${LOG_TAG} sending a batch to the backend failed:`,
            error,
        );
        throw error;
    }

    return { added, removed };
}

function* batched(songIds: readonly string[]) {
    for (let start = 0; start < songIds.length; start += SONG_SYNC_BATCH_SIZE) {
        yield songIds.slice(start, start + SONG_SYNC_BATCH_SIZE);
    }
}

/**
 * Reads a paged MusicKit source until it runs out or the job is cancelled, and
 * logs a line per page under `source`.
 *
 * `onPage` may return how many of the page's songs were new, which the line
 * reports. The playlist index has no such count, so its lines leave it out.
 */
async function forEachPage(
    source: string,
    readPage: (options: PageOptions) => Promise<SongInitPage>,
    onPage: (items: SongInitItem[]) => Promise<number | void>,
    isCancelled: () => boolean,
) {
    let offset: number | undefined = 0;

    while (offset !== undefined && !isCancelled()) {
        const pageOffset = offset;
        const page: SongInitPage = await readPage({
            limit: SONG_INIT_PAGE_SIZE,
            offset: pageOffset,
        });
        const newCount = await onPage(page.items);

        console.log(
            `${LOG_TAG} ${source} page at offset ${pageOffset}: ` +
                `${page.items.length} items` +
                (typeof newCount === "number" ? `, ${newCount} new` : "") +
                (page.hasNextPage ? "" : ", last page"),
        );

        // move on to the next page, if there is one
        offset =
            page.hasNextPage && page.items.length > 0
                ? page.nextOffset
                : undefined;
    }
}

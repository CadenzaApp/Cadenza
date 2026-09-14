/** MusicKit returns at most 100 library items a page. */
export const SONG_INIT_PAGE_SIZE = 100;

/** Songs per `POST /songs/default-tags`, under the backend's 200 song cap. */
export const SONG_INIT_BATCH_SIZE = 100;

/** The parts of a MusicKit `MusicItem` the job reads. */
export type SongInitItem = {
    id: string;
    catalogId?: string;
    libraryId?: string;
    title: string;
    artistName?: string;
};

/** One page of a paged MusicKit read. `LibraryResult` fits it. */
export type SongInitPage = {
    items: SongInitItem[];
    hasNextPage: boolean;
    nextOffset?: number;
};

type PageOptions = { limit: number; offset: number };

/** What the job reads from and writes to. `song-init.tsx` wires in MusicKit and the backend. */
export type SongInitDeps = {
    getLibrarySongs: (options: PageOptions) => Promise<SongInitPage>;
    getUserPlaylists: (options: PageOptions) => Promise<SongInitPage>;
    getPlaylistSongs: (
        playlistId: string,
        options: PageOptions,
    ) => Promise<SongInitPage>;
    /**
     * `POST /songs/untagged`. Initializes the requested songs that have tags of
     * either kind, and returns the ones with none.
     */
    getUntaggedSongs: (body: { song_ids: string[] }) => Promise<string[]>;
    /** `POST /songs/default-tags`. */
    setDefaultTags: (
        songs: { song_id: string; desc: string }[],
    ) => Promise<unknown>;
    /** Called after requests that may have initialized songs. */
    onSongsInitialized: () => void;
    /** Called with how many uninitialized songs the job has found and not finished with. */
    onUninitializedCountChange: (count: number) => void;
    isCancelled: () => boolean;
};

/**
 * Finds the songs in the user's library and library playlists that are not
 * initialized yet, then initializes them. The search covers every source
 * before any tags are generated, so the count is known before the slow part.
 */
export async function initializeSongs(deps: SongInitDeps) {
    const uninitialized = await findUninitializedSongs(deps);
    if (deps.isCancelled()) return;

    // the search read every song, which initialized the ones that already had tags
    deps.onSongsInitialized();

    await initializeInBatches(deps, uninitialized);
}

/**
 * Asks the backend about every song in the library, then in each playlist,
 * once per song. Returns the uninitialized ones as song id -> description. A
 * source that fails to read is logged and skipped.
 */
async function findUninitializedSongs(deps: SongInitDeps) {
    const uninitialized = new Map<string, string>();
    const checked = new Set<string>();

    const checkPage = async (songs: SongInitItem[]) => {
        // tags key on the catalog id when there is one, same as everywhere
        // else. a song an earlier page already had is skipped
        const unchecked = new Map<string, SongInitItem>();
        for (const song of songs) {
            const songId = song.catalogId ?? song.id;
            if (!checked.has(songId)) unchecked.set(songId, song);
        }
        if (unchecked.size === 0 || deps.isCancelled()) return;

        // reading the songs initializes the ones with tags and returns the rest
        const untaggedIds = await deps.getUntaggedSongs({
            song_ids: [...unchecked.keys()],
        });
        for (const songId of unchecked.keys()) checked.add(songId);

        // keep a description of each, to generate its tags from later
        for (const songId of untaggedIds) {
            const song = unchecked.get(songId);
            if (song) uninitialized.set(songId, describeSong(song));
        }
        if (untaggedIds.length > 0) {
            deps.onUninitializedCountChange(uninitialized.size);
        }
    };

    // the library first
    await trySearch("library songs", () =>
        forEachPage(deps.getLibrarySongs, checkPage, deps.isCancelled),
    );

    // then each playlist, which can hold songs that are not in the library
    await trySearch("playlists", () =>
        forEachPage(
            deps.getUserPlaylists,
            async (playlists) => {
                for (const playlist of playlists) {
                    // playlists are addressed by their library id
                    const playlistId = playlist.libraryId ?? playlist.id;
                    await trySearch(`playlist ${playlistId}`, () =>
                        forEachPage(
                            (options) =>
                                deps.getPlaylistSongs(playlistId, options),
                            checkPage,
                            deps.isCancelled,
                        ),
                    );
                }
            },
            deps.isCancelled,
        ),
    );

    return uninitialized;
}

/**
 * Generates default tags for the uninitialized songs a batch at a time, then
 * reads each batch back, which initializes the songs that got tags. A batch
 * that fails is logged and dropped. Its songs, like songs the model gave no
 * tags, stay uninitialized until the job runs again.
 */
async function initializeInBatches(
    deps: SongInitDeps,
    uninitialized: Map<string, string>,
) {
    const songs = [...uninitialized].map(([song_id, desc]) => ({
        song_id,
        desc,
    }));

    for (
        let start = 0;
        start < songs.length && !deps.isCancelled();
        start += SONG_INIT_BATCH_SIZE
    ) {
        const batch = songs.slice(start, start + SONG_INIT_BATCH_SIZE);

        try {
            // generate and store default tags for the batch
            await deps.setDefaultTags(batch);
            if (deps.isCancelled()) return;

            // read the batch back, which copies the new default tags to the user
            await deps.getUntaggedSongs({
                song_ids: batch.map((song) => song.song_id),
            });
            deps.onSongsInitialized();
        } catch (error) {
            console.error("Initializing a batch of songs failed:", error);
        }

        // the job is done with the batch either way, so it stops counting
        for (const { song_id } of batch) uninitialized.delete(song_id);
        deps.onUninitializedCountChange(uninitialized.size);
    }
}

/** Reads a paged MusicKit source until it runs out or the job is cancelled. */
async function forEachPage(
    readPage: (options: PageOptions) => Promise<SongInitPage>,
    onPage: (items: SongInitItem[]) => Promise<void>,
    isCancelled: () => boolean,
) {
    let offset: number | undefined = 0;

    while (offset !== undefined && !isCancelled()) {
        const page: SongInitPage = await readPage({
            limit: SONG_INIT_PAGE_SIZE,
            offset,
        });
        await onPage(page.items);

        // move on to the next page, if there is one
        offset =
            page.hasNextPage && page.items.length > 0
                ? page.nextOffset
                : undefined;
    }
}

/** Runs one part of the search, logging a failure rather than stopping the job. */
async function trySearch(source: string, search: () => Promise<void>) {
    try {
        await search();
    } catch (error) {
        console.error(`Searching ${source} for uninitialized songs failed:`, error);
    }
}

/** What a song's tags are generated from, e.g. "Override by Yoshida Yasei". */
function describeSong(song: SongInitItem) {
    return song.artistName ? `${song.title} by ${song.artistName}` : song.title;
}

/**
 * Paging over a long, ordered list of song ids that resolve to tracks a page at
 * a time as a list scrolls. A query result is the caller: it can hold thousands
 * of ids, and turning all of them into tracks up front would ask Apple Music
 * about every one.
 *
 * Pure, so `paged-tracks.test.ts` runs it under `node --test`.
 */

/**
 * The ids to ask Apple Music about so the first `requestedCount` ids can show:
 * every id the library cannot resolve, in list order, up to the last one inside
 * the window.
 *
 * Rounded up to whole chunks of `chunkSize`, the size each request is split
 * into. Growing the window then only ever adds chunks, and a chunk already
 * asked for is asked for the same way again, so its cached answer is reused
 * rather than reloaded with its rows missing in the meantime.
 */
export function catalogIdsToFetch(
    songIds: readonly string[],
    requestedCount: number,
    inLibrary: (songId: string) => boolean,
    chunkSize: number,
): string[] {
    const unresolved: string[] = [];
    let neededCount = 0;
    songIds.forEach((songId, index) => {
        if (inLibrary(songId)) return;
        unresolved.push(songId);
        if (index < requestedCount) neededCount = unresolved.length;
    });
    return unresolved.slice(0, Math.ceil(neededCount / chunkSize) * chunkSize);
}

/**
 * The tracks to show for the first `requestedCount` ids, in order, and how many
 * of those ids have been dealt with.
 *
 * While lookups are `pending`, the first id without a track ends the list, so
 * rows only ever append and never jump around as answers arrive. Once nothing
 * is pending, an id with no track (one Apple Music cannot see) is left out.
 *
 * Two ids can name the same track, a library id and a catalog id for one song,
 * so a track already shown is not shown again. `keyOf` says what makes a track
 * the same one.
 */
export function resolvedTracks<Track>(
    songIds: readonly string[],
    requestedCount: number,
    trackFor: (songId: string) => Track | undefined,
    keyOf: (track: Track) => string,
    pending: boolean,
): { tracks: Track[]; consumedCount: number } {
    const tracks: Track[] = [];
    const shown = new Set<string>();
    const end = Math.min(requestedCount, songIds.length);
    let index = 0;
    for (; index < end; index += 1) {
        const track = trackFor(songIds[index]);
        if (!track) {
            if (pending) break;
            continue;
        }
        const key = keyOf(track);
        if (shown.has(key)) continue;
        shown.add(key);
        tracks.push(track);
    }
    return { tracks, consumedCount: index };
}

/**
 * The ids a query result plays, in list order: every song that is certainly the
 * user's own, shown yet or not, and the other songs only once the list has
 * reached them. `loadedCount` is how many ids from the top the list has dealt
 * with (`resolvedTracks`'s `consumedCount`).
 */
export function queryQueueIds(
    songs: readonly { songId: string; certain: boolean }[],
    loadedCount: number,
): string[] {
    return songs.flatMap((song, index) =>
        song.certain || index < loadedCount ? [song.songId] : [],
    );
}

/** `values` without repeats, keeping the first of each by `keyOf`. */
export function uniqueBy<Value>(
    values: readonly Value[],
    keyOf: (value: Value) => string,
): Value[] {
    const seen = new Set<string>();
    return values.filter((value) => {
        const key = keyOf(value);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

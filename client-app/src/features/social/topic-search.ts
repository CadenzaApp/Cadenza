/**
 * Ranking for the post composer's topic search. The catalog contributes its
 * own capped songs and artists. Shared playlists the caller can open are
 * added when the name contains the query, then the whole list is ordered by
 * edit distance. A playlist comes before a song or artist at the same distance.
 */

/** Levenshtein distance, compared without regard to case. */
export function editDistance(a: string, b: string): number {
    const left = [...a.toLowerCase()];
    const right = [...b.toLowerCase()];
    let previous = Array.from(
        { length: right.length + 1 },
        (_, index) => index,
    );
    for (let i = 0; i < left.length; i++) {
        const next = [i + 1];
        for (let j = 0; j < right.length; j++) {
            const cost = left[i] === right[j] ? 0 : 1;
            next[j + 1] = Math.min(
                next[j] + 1,
                previous[j + 1] + 1,
                previous[j] + cost,
            );
        }
        previous = next;
    }
    return previous[right.length];
}

type Ranked<Song, Artist, Playlist> =
    | { kind: "song"; song: Song }
    | { kind: "artist"; artist: Artist }
    | { kind: "playlist"; playlist: Playlist };

/**
 * `songs` and `artists` are the catalog hits already chosen for the list.
 * A playlist is added when its name contains `query`. Closer names come
 * first. Equal distances keep playlists ahead of songs and artists, and
 * otherwise keep the order they were given.
 */
export function rankTopicSearch<
    Song extends { title: string },
    Artist extends { name: string },
    Playlist extends { name: string },
>(
    query: string,
    songs: readonly Song[],
    artists: readonly Artist[],
    playlists: readonly Playlist[],
): Ranked<Song, Artist, Playlist>[] {
    const term = query.toLowerCase();
    const hits: {
        distance: number;
        playlist: boolean;
        index: number;
        hit: Ranked<Song, Artist, Playlist>;
    }[] = [];
    const push = (
        label: string,
        playlist: boolean,
        hit: Ranked<Song, Artist, Playlist>,
    ) => {
        hits.push({
            distance: editDistance(query, label),
            playlist,
            index: hits.length,
            hit,
        });
    };
    for (const artist of artists)
        push(artist.name, false, { kind: "artist", artist });
    for (const song of songs) push(song.title, false, { kind: "song", song });
    for (const playlist of playlists) {
        if (!playlist.name.toLowerCase().includes(term)) continue;
        push(playlist.name, true, { kind: "playlist", playlist });
    }
    hits.sort((a, b) => {
        if (a.distance !== b.distance) return a.distance - b.distance;
        if (a.playlist !== b.playlist) return a.playlist ? -1 : 1;
        return a.index - b.index;
    });
    return hits.map((row) => row.hit);
}

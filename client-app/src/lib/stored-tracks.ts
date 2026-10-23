import type { MusicItem } from "@apple-musickit";

/**
 * A song's row as the backend stores it in `metadata_song_tags_applied`, sent
 * with a sorted or grouped query's songs (`row` on `POST /queries/results`).
 */
export type StoredSongRowJSON = {
    title: string;
    artist_name?: string | null;
    album_name?: string | null;
    album_id?: string | null;
    duration_ms?: number | null;
    artwork_url?: string | null;
};

/** The size the backend stores artwork at, and the size the player wants. */
const STORED_ARTWORK_SIZE = "512x512";
const LARGE_ARTWORK_SIZE = "1200x1200";

/**
 * A track made from the backend's stored row, so a sorted list draws its rows
 * at once rather than asking Apple for every song first. It carries what a row
 * and playback need: the ids, title, artist, album, length and artwork. A
 * library id (`i.`) plays as a library song, anything else as a catalog song.
 */
export function storedTrack(songId: string, row: StoredSongRowJSON): MusicItem {
    const library = songId.startsWith("i.");
    const artworkUrl = row.artwork_url || undefined;
    return {
        id: songId,
        resourceKind: "song",
        source: library ? "library" : "catalog",
        ...(library ? { libraryId: songId } : { catalogId: songId }),
        title: row.title,
        artistName: row.artist_name ?? undefined,
        artworkUrl,
        artworkUrlLarge: artworkUrl?.replace(
            `/${STORED_ARTWORK_SIZE}`,
            `/${LARGE_ARTWORK_SIZE}`,
        ),
        // the enum's values, written out so this stays importable without
        // the native module
        playbackType: (library
            ? "librarySong"
            : "song") as MusicItem["playbackType"],
        albumID: row.album_id ?? undefined,
        albumName: row.album_name ?? undefined,
        songDuration:
            row.duration_ms != null ? row.duration_ms / 1000 : undefined,
    };
}

/** Every stored row in a response, as tracks keyed by song id. */
export function storedTracks(
    songs: readonly { song_id: string; row?: StoredSongRowJSON | null }[],
): Map<string, MusicItem> {
    const tracks = new Map<string, MusicItem>();
    for (const song of songs) {
        if (song.row?.title) {
            tracks.set(song.song_id, storedTrack(song.song_id, song.row));
        }
    }
    return tracks;
}

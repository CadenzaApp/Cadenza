/**
 * What one play of a song is worth to the user's interest in its artist and
 * genres. Its runtime imports are pure, so it can be unit tested without React
 * Native.
 */

import type { InterestScoreDelta } from "@/lib/types";

/** What one play adds to the user's interest in the song's artist. */
export const ARTIST_PLAY_INTEREST_DELTA = 1;

/** What one play adds to the user's interest in each of the song's genres. */
export const GENRE_PLAY_INTEREST_DELTA = 1;

/**
 * Apple lists this genre on nearly every song on top of its real ones, so it
 * says nothing about what the user likes.
 */
const CATCH_ALL_GENRE = "music";

/**
 * The `PATCH /social/interests/update` deltas for one play of a song:
 * `ARTIST_PLAY_INTEREST_DELTA` for its artist and `GENRE_PLAY_INTEREST_DELTA`
 * for each of its genres, named as Apple Music names them.
 *
 * A blank name is dropped, and so is Apple's catch-all "Music" genre. A genre
 * listed twice counts once. The social feed service keys an interest by its
 * exact name, so names only lose surrounding whitespace.
 */
export function playInterestScoreDeltas(track: {
    artistName?: string;
    genres?: readonly string[];
}): InterestScoreDelta[] {
    const deltas: InterestScoreDelta[] = [];

    const artist = track.artistName?.trim();
    if (artist) {
        deltas.push({
            name: artist,
            itype: "artist",
            delta: ARTIST_PLAY_INTEREST_DELTA,
        });
    }

    const genres = new Set(
        (track.genres ?? [])
            .map((genre) => genre.trim())
            .filter(
                (genre) => genre && genre.toLowerCase() !== CATCH_ALL_GENRE,
            ),
    );
    for (const genre of genres) {
        deltas.push({
            name: genre,
            itype: "genre",
            delta: GENRE_PLAY_INTEREST_DELTA,
        });
    }

    return deltas;
}

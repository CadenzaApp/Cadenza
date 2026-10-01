import assert from "node:assert/strict";
import test from "node:test";

import {
    ARTIST_PLAY_INTEREST_DELTA,
    GENRE_PLAY_INTEREST_DELTA,
    playInterestScoreDeltas,
} from "./interest-score-deltas.ts";

test("a play scores the artist and each genre", () => {
    assert.deepEqual(
        playInterestScoreDeltas({
            artistName: "Phoebe Bridgers",
            genres: ["Alternative", "Singer/Songwriter"],
        }),
        [
            {
                name: "Phoebe Bridgers",
                itype: "artist",
                delta: ARTIST_PLAY_INTEREST_DELTA,
            },
            {
                name: "Alternative",
                itype: "genre",
                delta: GENRE_PLAY_INTEREST_DELTA,
            },
            {
                name: "Singer/Songwriter",
                itype: "genre",
                delta: GENRE_PLAY_INTEREST_DELTA,
            },
        ],
    );
});

test("a track with no artist or genres scores nothing", () => {
    assert.deepEqual(playInterestScoreDeltas({}), []);
    assert.deepEqual(
        playInterestScoreDeltas({ artistName: "  ", genres: [] }),
        [],
    );
});

test("the catch-all Music genre is dropped", () => {
    assert.deepEqual(
        playInterestScoreDeltas({ genres: ["Pop", "Music", "music"] }),
        [{ name: "Pop", itype: "genre", delta: GENRE_PLAY_INTEREST_DELTA }],
    );
});

test("a genre listed twice counts once, and blank ones are dropped", () => {
    assert.deepEqual(
        playInterestScoreDeltas({ genres: ["Rock", " Rock ", ""] }),
        [{ name: "Rock", itype: "genre", delta: GENRE_PLAY_INTEREST_DELTA }],
    );
});

test("names lose surrounding whitespace only", () => {
    assert.deepEqual(
        playInterestScoreDeltas({ artistName: " Tyler, The Creator " }),
        [
            {
                name: "Tyler, The Creator",
                itype: "artist",
                delta: ARTIST_PLAY_INTEREST_DELTA,
            },
        ],
    );
});

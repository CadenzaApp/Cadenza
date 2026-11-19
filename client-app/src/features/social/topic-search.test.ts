import assert from "node:assert/strict";
import test from "node:test";

import { editDistance, rankTopicSearch } from "./topic-search.ts";

const song = (title: string) => ({ title });
const artist = (name: string) => ({ name });
const playlist = (name: string) => ({ name });

test("edit distance ignores case", () => {
    assert.equal(editDistance("Road", "road"), 0);
    assert.equal(editDistance("road", "toad"), 1);
    assert.equal(editDistance("", "ab"), 2);
});

test("playlists join the catalog hits and closer names come first", () => {
    const ranked = rankTopicSearch(
        "trip",
        [song("Trip hop"), song("Strip")],
        [artist("Trip")],
        [playlist("Trips"), playlist("Friday")],
    );
    assert.deepEqual(
        ranked.map((hit) =>
            hit.kind === "playlist"
                ? hit.playlist.name
                : hit.kind === "song"
                  ? hit.song.title
                  : hit.artist.name,
        ),
        ["Trip", "Trips", "Strip", "Trip hop"],
    );
});

test("a shared playlist wins a tie with a song or artist", () => {
    const ranked = rankTopicSearch(
        "road",
        [song("Road")],
        [artist("Road")],
        [playlist("Road"), playlist("road")],
    );
    assert.deepEqual(
        ranked.map((hit) => hit.kind),
        ["playlist", "playlist", "artist", "song"],
    );
});

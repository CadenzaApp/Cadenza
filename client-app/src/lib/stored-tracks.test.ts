import assert from "node:assert/strict";
import test from "node:test";

import { storedTrack, storedTracks } from "./stored-tracks.ts";

test("a catalog song plays by its catalog id, with large artwork", () => {
    const track = storedTrack("1440857781", {
        title: "Purple Rain",
        artist_name: "Prince",
        album_name: "Purple Rain",
        album_id: "1440857000",
        duration_ms: 521000,
        artwork_url: "https://is1.example/image/thumb/a/512x512bb.jpg",
    });
    assert.equal(track.id, "1440857781");
    assert.equal(track.catalogId, "1440857781");
    assert.equal(track.libraryId, undefined);
    assert.equal(track.source, "catalog");
    assert.equal(track.playbackType, "song");
    assert.equal(track.songDuration, 521);
    assert.equal(track.albumID, "1440857000");
    assert.equal(
        track.artworkUrlLarge,
        "https://is1.example/image/thumb/a/1200x1200bb.jpg",
    );
});

test("a library id plays as a library song, and no artwork is none", () => {
    const track = storedTrack("i.abc123", { title: "Demo", artwork_url: "" });
    assert.equal(track.libraryId, "i.abc123");
    assert.equal(track.catalogId, undefined);
    assert.equal(track.source, "library");
    assert.equal(track.playbackType, "librarySong");
    assert.equal(track.artworkUrl, undefined);
    assert.equal(track.artistName, undefined);
});

test("only songs with a stored title become tracks", () => {
    const tracks = storedTracks([
        { song_id: "a", row: { title: "A" } },
        { song_id: "b" },
        { song_id: "c", row: null },
    ]);
    assert.deepEqual([...tracks.keys()], ["a"]);
});

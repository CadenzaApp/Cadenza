import assert from "node:assert/strict";
import test from "node:test";

import { trackMetadata } from "./track-metadata.ts";

/** The fields `trackMetadata` reads, as a `MusicItem` carries them. */
function track(fields: Partial<Parameters<typeof trackMetadata>[0]>) {
    return {
        id: "1",
        resourceKind: "song",
        source: "catalog",
        title: "a song",
        playbackType: "song",
        ...fields,
    } as Parameters<typeof trackMetadata>[0];
}

test("a catalog track yields all four fields", () => {
    assert.deepEqual(
        trackMetadata(
            track({
                artistName: "Phoebe Bridgers",
                artistId: "966309175",
                albumName: "Punisher",
                albumID: "1504438806",
            }),
        ),
        {
            artistName: "Phoebe Bridgers",
            artistId: "966309175",
            albumName: "Punisher",
            albumId: "1504438806",
        },
    );
});

test("albumID becomes albumId, so both ids read the same way", () => {
    const metadata = trackMetadata(track({ albumID: "123" }));
    assert.equal(metadata.albumId, "123");
    assert.equal("albumID" in metadata, false);
});

test("a library-only track keeps its names and has no ids", () => {
    assert.deepEqual(
        trackMetadata(
            track({ artistName: "black midi", albumName: "Hellfire" }),
        ),
        { artistName: "black midi", albumName: "Hellfire" },
    );
});

test("a bare track yields nothing rather than empty strings", () => {
    assert.deepEqual(trackMetadata(track({})), {});
});

test("values are trimmed", () => {
    assert.deepEqual(
        trackMetadata(track({ artistName: "  Fontaines D.C.  " })),
        {
            artistName: "Fontaines D.C.",
        },
    );
});

test("a blank value is dropped, since a blank name is not a group", () => {
    assert.deepEqual(
        trackMetadata(
            track({ artistName: "   ", albumName: "", albumID: " " }),
        ),
        {},
    );
});

test("a source rides along, trimmed", () => {
    assert.deepEqual(
        trackMetadata(track({}), {
            kind: "playlist",
            id: " p.abc ",
            name: " Late Night ",
        }),
        { source: { kind: "playlist", id: "p.abc", name: "Late Night" } },
    );
});

test("a source with no id or no name is dropped", () => {
    for (const source of [
        { kind: "playlist" as const, id: "", name: "Late Night" },
        { kind: "query" as const, id: "{}", name: "  " },
    ]) {
        assert.deepEqual(trackMetadata(track({}), source), {});
    }
});

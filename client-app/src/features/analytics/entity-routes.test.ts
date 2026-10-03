import assert from "node:assert/strict";
import test from "node:test";

import {
    albumRouteFor,
    artistRouteFor,
    type RankedEntity,
} from "./entity-routes.ts";

function entity(fields: Partial<RankedEntity> = {}): RankedEntity {
    return {
        key: "phoebe bridgers",
        label: "Phoebe Bridgers",
        sub_label: null,
        entity_id: null,
        ...fields,
    };
}

/** Only the fields these builders read. */
function sample(fields: Record<string, unknown> = {}) {
    return {
        id: "1",
        resourceKind: "song",
        source: "catalog",
        title: "a song",
        playbackType: "song",
        ...fields,
    } as Parameters<typeof artistRouteFor>[1];
}

// ----- artists -----

test("an artist with a recorded id opens its page", () => {
    const route = artistRouteFor(entity({ entity_id: "966309175" }));
    assert.equal(route?.pathname, "/artist/[id]");
    assert.equal(route?.params.id, "966309175");
    assert.equal(route?.params.name, "Phoebe Bridgers");
});

test("an artist with no id falls back to the sample track's id", () => {
    const route = artistRouteFor(entity(), sample({ artistId: "966309175" }));
    assert.equal(route?.params.id, "966309175");
});

test("an artist with no id anywhere is inert", () => {
    assert.equal(artistRouteFor(entity()), null);
    assert.equal(artistRouteFor(entity(), sample()), null);
});

test("the row's own id wins over the sample track's", () => {
    const route = artistRouteFor(
        entity({ entity_id: "from-the-row" }),
        sample({ artistId: "from-the-track" }),
    );
    assert.equal(route?.params.id, "from-the-row");
});

// ----- albums -----

test("an album prefers the sample track, which carries the artwork", () => {
    const route = albumRouteFor(
        entity({ label: "Punisher", sub_label: "Phoebe Bridgers" }),
        sample({
            albumID: "1504438806",
            artworkUrl: "https://example.test/small.jpg",
            artworkUrlLarge: "https://example.test/large.jpg",
            artworkColor: "#1a1a1a",
        }),
    );
    assert.equal(route?.pathname, "/collection/[kind]/[id]");
    assert.equal(route?.params.kind, "album");
    assert.equal(route?.params.id, "1504438806");
    assert.equal(route?.params.title, "Punisher");
    assert.equal(route?.params.artistName, "Phoebe Bridgers");
    assert.equal(route?.params.artworkColor, "#1a1a1a");
    // the small one, since this is what the tint is averaged from
    assert.equal(route?.params.artworkUrl, "https://example.test/small.jpg");
});

test("an album falls back to its own id when the track did not resolve", () => {
    const route = albumRouteFor(
        entity({ label: "Punisher", entity_id: "1504438806" }),
    );
    assert.equal(route?.params.id, "1504438806");
    assert.equal(route?.params.artworkUrl, undefined);
});

test("an album with no id anywhere is inert", () => {
    assert.equal(albumRouteFor(entity({ label: "Punisher" })), null);
});

test("an album with no label still has a title", () => {
    const route = albumRouteFor(
        entity({ label: null, entity_id: "123" }),
        sample({ albumName: "Hellfire" }),
    );
    assert.equal(route?.params.title, "Hellfire");

    const bare = albumRouteFor(entity({ label: null, entity_id: "123" }));
    assert.equal(bare?.params.title, "Album");
});

test("only the large artwork still fills the small slot", () => {
    const route = albumRouteFor(
        entity({ entity_id: "123" }),
        sample({ artworkUrlLarge: "https://example.test/large.jpg" }),
    );
    assert.equal(route?.params.artworkUrl, "https://example.test/large.jpg");
});

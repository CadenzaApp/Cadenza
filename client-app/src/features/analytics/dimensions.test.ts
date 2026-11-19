import assert from "node:assert/strict";
import test from "node:test";

import {
    albumRouteFor,
    artistRouteFor,
    DIMENSIONS,
    dimensionByName,
    matchesByName,
    playlistRouteFor,
    queryRouteFor,
    searchTermFor,
    sharedPlaylistRouteFor,
    type RankedEntity,
} from "./dimensions.ts";
import { encodeQuerySource } from "../../lib/play-source.ts";

// ----- the registry -----

test("every dimension is complete enough to draw and title", () => {
    for (const dimension of DIMENSIONS) {
        assert.ok(dimension.pageTitle.length > 0, dimension.name);
        assert.ok(dimension.emptyLabel.length > 0, dimension.name);
    }
});

test("names are unique, since they key the summary and the route", () => {
    const names = DIMENSIONS.map((dimension) => dimension.name);
    assert.equal(new Set(names).size, names.length);
});

test("every dimension is reachable by name", () => {
    for (const dimension of DIMENSIONS) {
        assert.equal(dimensionByName(dimension.name), dimension);
    }
});

test("an unknown name resolves to nothing rather than a default", () => {
    // the dynamic route passes whatever is in the url, so this has to be safe
    assert.equal(dimensionByName("genre"), undefined);
    assert.equal(dimensionByName(""), undefined);
    assert.equal(dimensionByName("../../etc"), undefined);
});

test("songs play, people open their profile, the rest navigate", () => {
    // neither has an href builder: a song row plays, a person opens a profile
    for (const dimension of DIMENSIONS) {
        assert.equal(
            dimension.hrefFor === null,
            dimension.name === "song" || dimension.person === true,
            dimension.name,
        );
    }
});

test("songs see all on the playable page, the rest on the shared route", () => {
    assert.deepEqual(dimensionByName("song")?.seeAllHref, {
        pathname: "/analytics/songs",
    });
    for (const dimension of DIMENSIONS) {
        if (dimension.name === "song") continue;
        assert.deepEqual(dimension.seeAllHref, {
            pathname: "/analytics/[dimension]",
            params: { dimension: dimension.name },
        });
    }
});

test("only artists and people are drawn round", () => {
    for (const dimension of DIMENSIONS) {
        assert.equal(
            dimension.roundArtwork,
            dimension.name === "artist" || dimension.person === true,
            dimension.name,
        );
    }
});

// ----- where a row goes -----

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

test("an album with no id of its own opens the sample's, with its artwork", () => {
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

test("an album's own id wins over the sample's, which might be another release", () => {
    const route = albumRouteFor(
        entity({ label: "Suzume - Single", entity_id: "the-single" }),
        sample({
            albumID: "the-soundtrack",
            artworkUrl: "https://example.test/soundtrack.jpg",
        }),
    );
    assert.equal(route?.params.id, "the-single");
    // the soundtrack's cover would tint the single's page wrong
    assert.equal(route?.params.artworkUrl, undefined);
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
        sample({ albumID: "123", albumName: "Hellfire" }),
    );
    assert.equal(route?.params.title, "Hellfire");

    const bare = albumRouteFor(entity({ label: null, entity_id: "123" }));
    assert.equal(bare?.params.title, "Album");
});

test("only the large artwork still fills the small slot", () => {
    const route = albumRouteFor(
        entity({ entity_id: "123" }),
        sample({
            albumID: "123",
            artworkUrlLarge: "https://example.test/large.jpg",
        }),
    );
    assert.equal(route?.params.artworkUrl, "https://example.test/large.jpg");
});

// ----- playlists -----

test("a playlist opens its page by its recorded id", () => {
    const route = playlistRouteFor(
        entity({ label: "Late Night", entity_id: "p.abc" }),
    );
    assert.deepEqual(route, {
        pathname: "/collection/[kind]/[id]",
        params: { kind: "playlist", id: "p.abc", title: "Late Night" },
    });
});

test("a playlist with no id is inert", () => {
    assert.equal(playlistRouteFor(entity({ label: "Late Night" })), null);
});

// ----- queries -----

test("a query reruns with its tree and its suggested flag", () => {
    const query = {
        where: {
            filter: {
                field: "tag" as const,
                tag_id: 1,
                op: "is_applied" as const,
            },
        },
    };
    const route = queryRouteFor(
        entity({
            label: "Chill",
            entity_id: encodeQuerySource({ query, suggested: true }),
        }),
    );
    assert.equal(route?.pathname, "/query-results");
    assert.deepEqual(JSON.parse(route?.params.query ?? ""), query);
    assert.equal(route?.params.suggested, "1");
    assert.equal(route?.params.name, "Chill");
});

test("a query whose id is not a query is inert", () => {
    assert.equal(queryRouteFor(entity({ entity_id: "p.abc" })), null);
    assert.equal(queryRouteFor(entity()), null);
});

test("shared playlists open by their id", () => {
    const entity = {
        key: "7",
        label: "Road trip",
        sub_label: null,
        entity_id: "7",
    };
    assert.deepEqual(sharedPlaylistRouteFor(entity), {
        pathname: "/shared-playlist/[id]",
        params: { id: "7" },
    });
    assert.equal(sharedPlaylistRouteFor({ ...entity, entity_id: null }), null);
});

// ----- finding a row by name -----

test("an artist matches by name, case and spaces aside", () => {
    assert.ok(matchesByName(entity(), { name: " phoebe bridgers " }));
    assert.ok(!matchesByName(entity(), { name: "Phoebe Bridgers & Friends" }));
});

test("an album needs its artist to match too", () => {
    const album = entity({ label: "Punisher", sub_label: "Phoebe Bridgers" });
    assert.ok(
        matchesByName(album, {
            name: "Punisher",
            artistName: "Phoebe Bridgers",
        }),
    );
    assert.ok(
        !matchesByName(album, { name: "Punisher", artistName: "Someone Else" }),
    );
});

test("a row with no name matches nothing and searches nothing", () => {
    const bare = entity({ label: null });
    assert.ok(!matchesByName(bare, { name: "" }));
    assert.equal(searchTermFor(bare), undefined);
});

test("an album searches by its name and artist", () => {
    assert.equal(
        searchTermFor(
            entity({ label: "Punisher", sub_label: "Phoebe Bridgers" }),
        ),
        "Punisher Phoebe Bridgers",
    );
});

test("a live session row is its host's session, and a person", () => {
    const sessions = dimensionByName("live_session");
    assert.equal(
        sessions?.titleFor?.(entity({ label: "caleb" })),
        "caleb's session",
    );
    assert.equal(sessions?.person, true);
    assert.equal(sessions?.hrefFor, null);
});

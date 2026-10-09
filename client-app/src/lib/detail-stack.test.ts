import assert from "node:assert/strict";
import test from "node:test";

import {
    detailIdentity,
    detailRouteFor,
    routesAfterOpening,
    type StackRoute,
} from "./detail-stack.ts";

const tabs = { key: "tabs", name: "(tabs)" };

function artist(id: string, key = `artist-${id}`): StackRoute {
    return { key, name: "artist/[id]", params: { id } };
}

function playlist(id: string, key = `playlist-${id}`): StackRoute {
    return {
        key,
        name: "collection/[kind]/[id]",
        params: { kind: "playlist", id, title: "Mix" },
    };
}

function names(routes: readonly StackRoute[]) {
    return routes.map((route) => route.key ?? "new");
}

// ----- resolving an href -----

test("a pattern href resolves with its params as strings", () => {
    assert.deepEqual(
        detailRouteFor({
            pathname: "/collection/[kind]/[id]",
            params: { kind: "album", id: "1", title: "Blue" },
        }),
        {
            name: "collection/[kind]/[id]",
            params: { kind: "album", id: "1", title: "Blue" },
        },
    );
});

test("a concrete path binds its dynamic segments", () => {
    assert.deepEqual(detailRouteFor("/tag/12"), {
        name: "tag/[tagId]",
        params: { tagId: "12" },
    });
});

test("query results resolve and anything else does not", () => {
    assert.equal(
        detailRouteFor({
            pathname: "/query-results",
            params: { query: "{}", suggested: "" },
        })?.name,
        "query-results",
    );
    assert.equal(detailRouteFor("/account"), null);
    assert.equal(detailRouteFor("/player"), null);
    assert.equal(detailRouteFor({ pathname: "/analytics/songs" }), null);
    assert.equal(detailRouteFor("/tag/12?x=1"), null);
});

test("a pattern href missing its id does not resolve", () => {
    assert.equal(
        detailRouteFor({ pathname: "/artist/[id]", params: {} }),
        null,
    );
});

// ----- identity -----

test("identity ignores drawing hints", () => {
    const a = { name: "artist/[id]", params: { id: "7", name: "Phoebe" } };
    const b = { name: "artist/[id]", params: { id: "7" } };
    assert.equal(detailIdentity(a), detailIdentity(b));
    assert.notEqual(
        detailIdentity(playlist("7")),
        detailIdentity({
            name: "collection/[kind]/[id]",
            params: { kind: "album", id: "7" },
        }),
    );
    assert.equal(detailIdentity(tabs), null);
});

// ----- opening -----

test("opening the screen on top changes nothing", () => {
    const routes = [tabs, artist("a")];
    const next = routesAfterOpening(routes, artist("a", "fresh"));
    assert.deepEqual(names(next), ["tabs", "artist-a"]);
    assert.equal(next[1], routes[1]);
});

test("opening a screen already below goes back to it", () => {
    const routes = [tabs, artist("a"), playlist("p")];
    assert.deepEqual(names(routesAfterOpening(routes, artist("a", "fresh"))), [
        "tabs",
        "artist-a",
    ]);
});

test("going back drops a sheet above too", () => {
    const routes = [tabs, artist("a"), { key: "player", name: "player" }];
    assert.deepEqual(names(routesAfterOpening(routes, artist("a", "fresh"))), [
        "tabs",
        "artist-a",
    ]);
});

test("a new screen is pushed", () => {
    const routes = [tabs, artist("a")];
    assert.deepEqual(names(routesAfterOpening(routes, playlist("p", "new"))), [
        "tabs",
        "artist-a",
        "new",
    ]);
});

test("past the cap the oldest detail screens go", () => {
    const routes = [tabs, artist("a"), playlist("p"), artist("b")];
    assert.deepEqual(
        names(routesAfterOpening(routes, playlist("q", "new"), 3)),
        ["tabs", "playlist-p", "artist-b", "new"],
    );
});

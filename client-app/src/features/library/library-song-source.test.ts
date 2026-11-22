import assert from "node:assert/strict";
import test from "node:test";
import { librarySongSource } from "./library-song-source.ts";

test("Include all with tags includes only the account's library or tagged songs", () => {
    const source = librarySongSource(true, false, null);
    assert.equal(source?.kind, "query");
    if (source?.kind !== "query") return;
    assert.equal(source.scope, "libraryOrTagged");
    assert.equal(source.considerDefaultTags, false);
    assert.deepEqual(source.query, { where: { and: [] } });
});

test("turning the option off preserves native library browsing and search", () => {
    assert.equal(librarySongSource(false, false, null), null);
    assert.equal(librarySongSource(false, true, "hello"), null);
    const source = librarySongSource(false, true, null);
    if (source?.kind !== "query")
        assert.fail("sorted library needs its restricted query");
    assert.equal(source.scope, "library");
});

test("search keeps the widened scope and matches title, artist, or album", () => {
    const source = librarySongSource(true, true, "a 'quoted' song");
    if (source?.kind !== "query")
        assert.fail("tagged songs must remain searchable");
    assert.equal(source.scope, "libraryOrTagged");
    const node = source.query.where;
    if (!("or" in node)) assert.fail("search must match any metadata field");
    assert.deepEqual(
        node.or,
        ["title", "artist", "album"].map((key) => ({
            filter: {
                field: "metadata",
                key,
                op: "contains",
                value: "a 'quoted' song",
            },
        })),
    );
});

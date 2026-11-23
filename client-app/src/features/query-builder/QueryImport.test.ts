import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { QueryJSON } from "../../lib/query-json.ts";
import type { Tag } from "../../lib/types.ts";
import { buildAdvancedQuery } from "../advanced-query-builder/AdvancedQueryUtils.ts";
import {
    fitsSimple,
    queryToAdvanced,
    queryToSimple,
    type ImportTags,
} from "./QueryImport.ts";
import { hasSuggestedTag, queryToJSON } from "./QueryUtils.ts";

/**
 * Shared with the backend's `fits_simple`, so both sides agree on which
 * builder a query goes to.
 */
type Fixture = {
    name: string;
    query: QueryJSON;
    simple: boolean;
    /** What Simple writes back, when it is not `query` itself. */
    simple_json?: QueryJSON;
    /** What Advanced writes back, when it is not `query` itself. */
    advanced_json?: QueryJSON;
};

const fixtures: Fixture[] = JSON.parse(
    readFileSync(
        fileURLToPath(
            new URL(
                "../../../../backend-api/src/services/assistant/builder_fixtures.json",
                import.meta.url,
            ),
        ),
        "utf8",
    ),
);

const tag = (id: number, name: string, type: Tag["type"]): Tag => ({
    id,
    name,
    color: "#123456",
    type,
});
const tags = [
    tag(1, "chill", "basic"),
    tag(2, "gym", "basic"),
    tag(3, "rating", "number"),
    tag(4, "seen", "date"),
    tag(5, "mood", "text"),
];
const lookup: ImportTags = {
    tags: new Map(tags.map((item) => [item.id, item])),
};
const tagTypes = new Map(tags.map((item) => [item.id, item.type]));

test("the fixtures cover both builders", () => {
    assert.ok(fixtures.some((fixture) => fixture.simple));
    assert.ok(fixtures.some((fixture) => !fixture.simple));
});

for (const fixture of fixtures) {
    test(`fits ${fixture.simple ? "Simple" : "only Advanced"}: ${fixture.name}`, () => {
        assert.equal(fitsSimple(fixture.query), fixture.simple);
        const conditions = queryToSimple(fixture.query, lookup);
        assert.equal(conditions !== null, fixture.simple);
        if (conditions) {
            assert.deepEqual(
                queryToJSON(conditions),
                fixture.simple_json ?? fixture.query,
            );
        }
    });

    test(`Advanced holds it: ${fixture.name}`, () => {
        const built = buildAdvancedQuery(
            queryToAdvanced(fixture.query),
            tagTypes,
        );
        assert.deepEqual(built, {
            ok: true,
            query: fixture.advanced_json ?? fixture.query,
        });
    });
}

test("a tag the user cannot see keeps a query out of Simple", () => {
    const query: QueryJSON = {
        where: {
            and: [{ filter: { field: "tag", tag_id: 99, op: "is_applied" } }],
        },
    };
    assert.equal(fitsSimple(query), true);
    assert.equal(queryToSimple(query, lookup), null);
});

test("a shared default tag comes in as suggested", () => {
    const query: QueryJSON = {
        where: {
            and: [{ filter: { field: "tag", tag_id: 50, op: "is_applied" } }],
        },
    };
    const conditions = queryToSimple(query, {
        ...lookup,
        suggested: new Map([[50, tag(50, "dreamy", "basic")]]),
    });
    assert.ok(conditions);
    assert.equal(hasSuggestedTag(conditions), true);
});

test("Simple's conditions share one outer connector", () => {
    const conditions = queryToSimple(
        {
            where: {
                or: [
                    { filter: { field: "tag", tag_id: 1, op: "is_applied" } },
                    { filter: { field: "tag", tag_id: 2, op: "is_applied" } },
                    {
                        filter: {
                            field: "tag",
                            tag_id: 3,
                            op: "gt",
                            value: "2",
                        },
                    },
                ],
            },
        },
        lookup,
    );
    assert.ok(conditions);
    assert.deepEqual(
        conditions.map((condition) => condition.connector),
        ["and", "or", "or"],
    );
    assert.ok(conditions.every((condition) => condition.layoutId));
});

test("a metadata filter becomes the metadata palette tag with its operator", () => {
    const conditions = queryToSimple(
        {
            where: {
                and: [
                    {
                        filter: {
                            field: "metadata",
                            key: "release_date",
                            op: "before",
                            value: "2015-01-01",
                        },
                    },
                ],
            },
        },
        lookup,
    );
    assert.ok(conditions);
    const [condition] = conditions;
    assert.equal(condition.kind, "tag");
    if (condition.kind !== "tag") return;
    assert.equal(condition.tag.name, "Release date");
    assert.deepEqual(condition.constraint, {
        op: "before",
        value: "2015-01-01",
    });
});

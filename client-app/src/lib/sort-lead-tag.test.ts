import assert from "node:assert/strict";
import test from "node:test";

import { sortLeadTag } from "./sort-lead-tag.ts";
import type { ArrangeField } from "./song-arrangement.ts";

const sort = (field: ArrangeField) => ({
    field,
    direction: "ascending" as const,
});

test("a tag sort leads with that tag, wherever it comes from", () => {
    assert.deepEqual(
        sortLeadTag(
            sort({
                kind: "tag",
                tagId: 7,
                name: "Mood",
                color: "#ff0000",
                type: "text",
                source: "suggested",
            }),
            undefined,
        ),
        { kind: "tag", tagId: 7, source: "suggested" },
    );
});

test("a metadata sort leads with a pill of each song's value, worded", () => {
    const lead = sortLeadTag(
        sort({ kind: "metadata", key: "duration" }),
        new Map([
            ["a", "521000"],
            ["b", "65000"],
        ]),
    );
    assert.equal(lead?.kind, "value");
    if (lead?.kind !== "value") return;
    assert.equal(lead.tag.name, "Duration");
    assert.equal(lead.values.get("a"), "8:41");
    assert.equal(lead.values.get("b"), "1:05");

    const explicit = sortLeadTag(
        sort({ kind: "metadata", key: "explicit" }),
        new Map([["a", "true"]]),
    );
    assert.equal(
        explicit?.kind === "value" ? explicit.values.get("a") : null,
        "Explicit",
    );
});

test("no sort, or one by what every row already shows, leads with nothing", () => {
    assert.equal(sortLeadTag(null, undefined), null);
    assert.equal(
        sortLeadTag(sort({ kind: "metadata", key: "title" }), undefined),
        null,
    );
    assert.equal(
        sortLeadTag(sort({ kind: "metadata", key: "artist" }), undefined),
        null,
    );
});

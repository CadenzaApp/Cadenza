import assert from "node:assert/strict";
import test from "node:test";

import { METADATA_TAG_COLOR, metadataTagPills } from "./song-metadata-tags.ts";

test("metadata tags become pills named like the query builder's fields", () => {
    const pills = metadataTagPills([
        { key: "title", type: "text", value: "Purple Rain" },
        { key: "release_date", type: "date", value: "1984-06-25" },
        { key: "duration", type: "number", value: "521000" },
        { key: "explicit", type: "checkbox", value: "false" },
        { key: "total_plays", type: "number", value: "12" },
    ]);

    assert.deepEqual(
        pills.map(({ tag, value }) => [tag.name, tag.type, value]),
        [
            ["Title", "text", "Purple Rain"],
            ["Release date", "date", "1984-06-25"],
            ["Duration (ms)", "number", "521000"],
            ["Explicit", "checkbox", "false"],
            ["Total Plays", "number", "12"],
        ],
    );
    for (const { tag } of pills) {
        assert.ok(tag.id < 0, "never a real tag id");
        assert.equal(tag.color, METADATA_TAG_COLOR);
    }
    assert.equal(new Set(pills.map(({ tag }) => tag.id)).size, pills.length);
});

test("no metadata tags is no pills", () => {
    assert.deepEqual(metadataTagPills([]), []);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
    TAG_TYPES,
    formatTagValue,
    validateTagValue,
    toCanonicalTagValue,
} from "./tag-values.ts";

test("duration values display units while preserving milliseconds on the wire", () => {
    assert.equal(formatTagValue("duration", "182000"), "3m 2s");
    assert.equal(formatTagValue("duration", "4092000"), "1h 8m 12s");
    assert.equal(formatTagValue("duration", "0"), "0s");
    assert.equal(toCanonicalTagValue("duration", "182000"), "182000");
    for (const value of ["-1", "NaN", "1.5", "Infinity"])
        assert.ok(validateTagValue("duration", value));
    assert.equal(validateTagValue("duration", "0"), null);
});

test("creation types use the requested order", () => {
    assert.deepEqual(TAG_TYPES, [
        "basic",
        "number",
        "date",
        "duration",
        "datetime",
        "checkbox",
        "text",
    ]);
});

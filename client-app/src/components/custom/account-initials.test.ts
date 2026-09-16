import assert from "node:assert/strict";
import test from "node:test";

import { getAccountInitials } from "./account-initials.ts";

test("account initials use up to two email name segments", () => {
    assert.equal(getAccountInitials("caleb.standfield@example.com"), "CS");
    assert.equal(getAccountInitials("caleb_standfield@example.com"), "CS");
    assert.equal(getAccountInitials("caleb@example.com"), "C");
});

test("account initials have a safe fallback", () => {
    assert.equal(getAccountInitials(undefined), "?");
    assert.equal(getAccountInitials("@example.com"), "?");
});

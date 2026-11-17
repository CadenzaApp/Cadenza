import assert from "node:assert/strict";
import test from "node:test";

import { cleanInviteCode, INVITE_CODE_LENGTH } from "./invite-code.ts";

test("typed codes uppercase and drop what cannot be in one", () => {
    assert.equal(cleanInviteCode("k7m2-qx9p"), "K7M2QX9P");
    // 0 O 1 I L are not in the alphabet
    assert.equal(cleanInviteCode("A0B1CIDL"), "ABCD");
});

test("a pasted link is cut down to its code", () => {
    assert.equal(cleanInviteCode("cadenza://join/K7M2QX9P"), "K7M2QX9P");
    assert.equal(
        cleanInviteCode(
            "Join me on Cadenza: cadenza://join/K7M2QX9P (code K7M2QX9P)",
        ),
        "K7M2QX9P",
    );
});

test("never longer than a code", () => {
    assert.equal(cleanInviteCode("ABCDEFGHJKMN").length, INVITE_CODE_LENGTH);
});

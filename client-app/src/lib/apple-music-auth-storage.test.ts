import assert from "node:assert/strict";
import test from "node:test";
import type { AuthResult, AuthStatus } from "@apple-musickit";

import {
    parseStoredAppleMusicAuth,
    serializeAppleMusicAuth,
} from "./apple-music-auth-storage.ts";

const authorized: AuthResult = {
    status: "authorized" as AuthStatus,
    userToken: "music-user-token",
};

test("restores a user token only under the developer JWT that acquired it", () => {
    const saved = serializeAppleMusicAuth(authorized, "developer-jwt-a");
    assert.deepEqual(
        parseStoredAppleMusicAuth(saved, "developer-jwt-a"),
        authorized,
    );
    assert.equal(parseStoredAppleMusicAuth(saved, "developer-jwt-b"), null);
});

test("discards the legacy unscoped token that iOS Keychain may keep after reinstall", () => {
    assert.equal(
        parseStoredAppleMusicAuth(
            JSON.stringify(authorized),
            "developer-jwt-b",
        ),
        null,
    );
});

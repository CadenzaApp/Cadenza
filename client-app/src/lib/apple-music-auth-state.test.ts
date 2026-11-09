import assert from "node:assert/strict";
import test from "node:test";
import type { AuthResult, AuthStatus } from "@apple-musickit";

import {
    shouldTrySilentRefresh,
    SILENT_REFRESH_COOLDOWN_MS,
    parseStoredAppleMusicAuth,
    serializeAppleMusicAuth,
    AppleMusicAuthGeneration,
} from "./apple-music-auth-state.ts";

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

test("a read from before reconnect cannot retire the new session", () => {
    const generation = new AppleMusicAuthGeneration();
    const oldRead = generation.snapshot();

    generation.beginTransition();
    assert.equal(generation.retireIfCurrent(oldRead), false);
    const duringReconnect = generation.snapshot();
    generation.endTransition();

    assert.equal(generation.retireIfCurrent(oldRead), false);
    assert.equal(generation.retireIfCurrent(duringReconnect), false);
    assert.equal(generation.retireIfCurrent(generation.snapshot()), true);
});

test("a failed session is retired once, not by every concurrent read", () => {
    const generation = new AppleMusicAuthGeneration();
    const read = generation.snapshot();

    assert.equal(generation.retireIfCurrent(read), true);
    assert.equal(generation.retireIfCurrent(read), false);
    assert.equal(generation.retireIfCurrent(generation.snapshot()), false);
});

test("silent refresh only replaces a session that was connected", () => {
    assert.equal(shouldTrySilentRefresh(false, null, 0), false);
    assert.equal(shouldTrySilentRefresh(true, null, 0), true);
});

test("a token rejected right after a refresh goes to reconnect, not another refresh", () => {
    const refreshedAt = 1_000;
    assert.equal(
        shouldTrySilentRefresh(true, refreshedAt, refreshedAt + 5_000),
        false,
    );
    assert.equal(
        shouldTrySilentRefresh(
            true,
            refreshedAt,
            refreshedAt + SILENT_REFRESH_COOLDOWN_MS,
        ),
        true,
    );
});

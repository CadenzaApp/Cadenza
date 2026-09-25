import assert from "node:assert/strict";
import test from "node:test";

import { classifyError, isAppleMusicAuthError } from "./app-error.ts";

/** What a chained native rejection actually looks like by the time it hits JS. */
function nativeError(name: string) {
    return Object.assign(
        new Error(
            `Calling the 'getRecentlyAdded' function has failed (at ExpoModulesCore/ConcurrentFunctionDefinition.swift:88)\n` +
                `→ Caused by: ${name}: Apple Music rejected the credentials (403): {"errors":[...]}`,
        ),
        { code: name },
    );
}

test("a 403 from apple music reads as an expired session, not a stack trace", () => {
    const appError = classifyError(nativeError("ERR_APPLE_MUSIC_AUTH"));

    assert.equal(appError.kind, "apple-music-auth");
    assert.equal(appError.title, "Apple Music session expired");
    assert.equal(appError.action?.href, "/account");
    assert.equal(appError.retryable, false);
    // the raw text is kept for logging but is not what the UI shows
    assert.ok(!appError.detail.includes("403"));
});

test("the native name is recovered from the message when there is no code", () => {
    const withoutCode = new Error(
        "→ Caused by: ERR_APPLE_MUSIC_AUTH: Apple Music rejected the credentials (403): {}",
    );

    assert.equal(classifyError(withoutCode).kind, "apple-music-auth");
});

test("a transient apple music failure stays retryable", () => {
    const appError = classifyError(nativeError("ERR_APPLE_MUSIC_API"));

    assert.equal(appError.kind, "apple-music-api");
    assert.equal(appError.retryable, true);
    assert.equal(appError.action, undefined);
});

test("a missing user token is the same story as a rejected one", () => {
    assert.ok(isAppleMusicAuthError(nativeError("ERR_MISSING_USER_TOKEN")));
    // a missing developer token is a build problem, not something a user fixes
    assert.ok(!isAppleMusicAuthError(nativeError("ERR_MISSING_TOKEN")));
});

test("the backend's plain-text 401 routes to sign in", () => {
    const appError = classifyError({
        error_type: "Unauthorized",
        status: 401,
        message: "Expired signature",
    });

    assert.equal(appError.kind, "session-expired");
    assert.equal(appError.action?.href, "/auth?initialMode=signin");
});

test("a dropped request reads as offline", () => {
    const appError = classifyError(new TypeError("Network request failed"));

    assert.equal(appError.kind, "offline");
    assert.equal(appError.retryable, true);
});

test("anything unrecognized still gets a usable message", () => {
    for (const value of [null, undefined, "boom", 42, new Error("kaboom")]) {
        const appError = classifyError(value);
        assert.equal(appError.kind, "unknown");
        assert.ok(appError.title.length > 0);
        assert.ok(appError.detail.length > 0);
    }
});

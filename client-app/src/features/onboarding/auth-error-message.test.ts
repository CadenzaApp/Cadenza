import assert from "node:assert/strict";
import test from "node:test";

import { authErrorMessage } from "./auth-error-message.ts";

test("known supabase codes get their own sentence", () => {
    assert.equal(
        authErrorMessage({
            name: "AuthApiError",
            code: "invalid_credentials",
            message: "Invalid login credentials",
        }),
        "Wrong email or password.",
    );
});

test("other auth errors keep supabase's message", () => {
    assert.equal(
        authErrorMessage({
            name: "AuthWeakPasswordError",
            code: "weak_password",
            message: "Password should be at least 6 characters.",
        }),
        "Password should be at least 6 characters.",
    );
});

test("a dropped connection says so", () => {
    assert.match(
        authErrorMessage(new TypeError("Network request failed")),
        /No connection/,
    );
});

test("anything else never prints raw", () => {
    assert.equal(
        authErrorMessage({ stack: "at foo.swift:12" }),
        "Could not sign in. Try again in a moment.",
    );
    assert.equal(
        authErrorMessage(null),
        "Could not sign in. Try again in a moment.",
    );
});

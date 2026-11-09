import assert from "node:assert/strict";
import test from "node:test";

import { onboardingStep, type OnboardingInput } from "./onboarding-step.ts";

const base: OnboardingInput = {
    signedIn: true,
    appleMusicReady: true,
    appleMusicConnected: false,
    connectStepDone: false,
};

test("signed out always goes to login", () => {
    assert.equal(
        onboardingStep({ ...base, signedIn: false, appleMusicReady: false }),
        "login",
    );
    assert.equal(
        onboardingStep({ ...base, signedIn: false, appleMusicConnected: true }),
        "login",
    );
});

test("waits for apple music and the stored step before routing", () => {
    assert.equal(
        onboardingStep({ ...base, appleMusicReady: false }),
        "pending",
    );
    assert.equal(onboardingStep({ ...base, connectStepDone: null }), "pending");
});

test("a new account without apple music lands on the connect step", () => {
    assert.equal(onboardingStep(base), "connect");
});

test("connected or already past the step goes to the app", () => {
    assert.equal(onboardingStep({ ...base, appleMusicConnected: true }), "app");
    // an expired token after onboarding does not send them back through it
    assert.equal(onboardingStep({ ...base, connectStepDone: true }), "app");
});

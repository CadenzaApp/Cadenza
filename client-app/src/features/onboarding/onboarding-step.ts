import type { Href } from "expo-router";

/**
 * Where a person is in getting into the app. `pending` means something it
 * depends on is still loading, so nothing should route yet.
 */
export type OnboardingStep = "login" | "connect" | "app" | "pending";

export type OnboardingInput = {
    signedIn: boolean;
    /** False while the stored Apple Music tokens are still being restored. */
    appleMusicReady: boolean;
    appleMusicConnected: boolean;
    /** Whether this account got past the connect step on this device. Null while it loads. */
    connectStepDone: boolean | null;
};

/**
 * Login first, then the Apple Music step, then the app. The connect step shows
 * once per account per device: after that a lost connection drops the app to
 * previews and offers a reconnect, it never sends someone back through onboarding.
 */
export function onboardingStep({
    signedIn,
    appleMusicReady,
    appleMusicConnected,
    connectStepDone,
}: OnboardingInput): OnboardingStep {
    if (!signedIn) return "login";
    if (!appleMusicReady || connectStepDone === null) return "pending";
    if (appleMusicConnected || connectStepDone) return "app";
    return "connect";
}

export const ONBOARDING_HREF: Record<
    Exclude<OnboardingStep, "pending">,
    Href
> = {
    login: "/auth",
    connect: "/auth/apple-music",
    app: "/library",
};

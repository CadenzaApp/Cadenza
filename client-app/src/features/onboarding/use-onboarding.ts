import { useCallback, useEffect } from "react";
import useSWR from "swr";

import { useAccount } from "@/lib/account";
import { useAppleMusic } from "@/lib/apple-music-auth";

import { loadConnectStepDone, saveConnectStepDone } from "./connect-step-store";
import { onboardingStep, type OnboardingStep } from "./onboarding-step";

/**
 * The current onboarding step, and the way past the Apple Music step. Every
 * screen that routes on onboarding (splash, login, connect, the tabs guard)
 * reads it from here, so they all agree.
 */
export function useOnboarding(): {
    step: OnboardingStep;
    finishConnectStep: () => Promise<void>;
} {
    const { account } = useAccount();
    const { isInitializing, isConnected } = useAppleMusic();
    const accountId = account?.id ?? null;

    const { data: done, mutate } = useSWR(
        accountId ? ["onboarding/connect-step-done", accountId] : null,
        ([, id]) => loadConnectStepDone(id),
    );

    const finishConnectStep = useCallback(async () => {
        if (!accountId) return;
        await saveConnectStepDone(accountId);
        await mutate(true, { revalidate: false });
    }, [accountId, mutate]);

    // a connection proves the step done, so a later expiry offers a
    // reconnect instead of sending them back through onboarding
    useEffect(() => {
        if (isConnected && done === false) void finishConnectStep();
    }, [isConnected, done, finishConnectStep]);

    const step = onboardingStep({
        signedIn: accountId !== null,
        appleMusicReady: !isInitializing,
        appleMusicConnected: isConnected,
        connectStepDone: done ?? null,
    });

    return { step, finishConnectStep };
}

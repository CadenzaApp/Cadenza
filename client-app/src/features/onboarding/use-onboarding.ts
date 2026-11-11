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

    const {
        data: done,
        isLoading,
        mutate,
    } = useSWR(
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

    // undefined while the read is in flight is still pending. undefined once
    // the read is idle means the cache was cleared and will not refetch, which
    // counts as not done: waiting on it holds the splash forever
    const connectStepDone =
        done !== undefined ? done : isLoading ? null : false;

    const step = onboardingStep({
        signedIn: accountId !== null,
        appleMusicReady: !isInitializing,
        appleMusicConnected: isConnected,
        connectStepDone,
    });

    return { step, finishConnectStep };
}

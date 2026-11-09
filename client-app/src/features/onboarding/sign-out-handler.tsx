import { useRouter, useSegments } from "expo-router";
import { useEffect, useRef } from "react";

import { useAccount } from "@/lib/account";

import { clearConnectStepDone } from "./connect-step-store";

/** Routes that already belong to a signed out person. */
const SIGNED_OUT_ROUTES = new Set(["(splashscreen)", "auth"]);

/**
 * Ends the signed in app when the account goes away, by sign out or by
 * Supabase ending the session. Renders nothing.
 *
 * The one place that navigates on sign out. Screens that need an account
 * render `null` without one instead of redirecting: a redirect from inside a
 * sheet replaces the sheet, which is what left login as a dismissable sheet.
 * Here `dismissAll` closes every sheet and pushed screen first, then `replace`
 * swaps the tabs for login, so nothing is left under it.
 *
 * Also forgets the connect step: the next sign in skips it only if Apple
 * Music is still connected. `PlaybackProvider` stops the music, since the
 * queue belonged to the old account.
 */
export function SignOutHandler() {
    const { account } = useAccount();
    const router = useRouter();
    const segments = useSegments();
    const onSignedOutRoute = SIGNED_OUT_ROUTES.has(segments[0] ?? "");
    // the account is already gone by the time the effect sees the sign out
    const lastAccountId = useRef<string | null>(null);

    useEffect(() => {
        const signedOutId = account ? null : lastAccountId.current;
        lastAccountId.current = account?.id ?? null;
        if (!signedOutId) return;

        void clearConnectStepDone(signedOutId);
        if (onSignedOutRoute) return;
        if (router.canDismiss()) router.dismissAll();
        router.replace("/auth?initialMode=signin");
    }, [account, onSignedOutRoute, router]);

    return null;
}

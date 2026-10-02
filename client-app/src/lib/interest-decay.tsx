import { useEffect, useRef } from "react";

import { useAccount } from "./account";
import { useDecayInterests } from "./routes/social";

/**
 * Sends one `PATCH /social/interests/decay` per app launch, as soon as someone
 * is signed in. It renders nothing.
 *
 * A launch with a restored session decays right away. A launch that lands on
 * sign in decays once the sign in finishes. Signing in to a different account
 * in the same launch decays that account too, once. A failure is logged and
 * swallowed: a missed decay only means the feed leans on older interests until
 * the next launch.
 *
 * Mounted at the root under `AccountProvider`.
 */
export function InterestDecay() {
    const { account } = useAccount();
    const { decayInterests } = useDecayInterests();
    const decayedIdsRef = useRef(new Set<string>());

    useEffect(() => {
        if (!account || decayedIdsRef.current.has(account.id)) return;
        decayedIdsRef.current.add(account.id);

        decayInterests().catch((e) =>
            console.warn("Failed to decay interests:", e),
        );
    }, [account, decayInterests]);

    return null;
}

import { useRouter, useSegments } from "expo-router";
import { useEffect, useRef } from "react";

import { useAppleMusic } from "@/lib/apple-music-auth";

/**
 * Routes it must not open over: onboarding, which has its own connect step,
 * and the reconnect page itself.
 */
const UNINTERRUPTIBLE = new Set([
    "(splashscreen)",
    "auth",
    "reconnect-apple-music",
]);

/**
 * Opens the reconnect page once when Apple rejects the stored music-user token.
 *
 * Renders nothing. The app keeps working on previews meanwhile, so the page
 * can be dismissed. It opens once per expiry, not once per failed read, so a
 * screen firing several reads at once cannot stack modals or fight navigation.
 */
export function AppleMusicSessionGuard() {
    const { sessionExpired } = useAppleMusic();
    const router = useRouter();
    const segments = useSegments();
    const alreadyOpened = useRef(false);

    const onUninterruptibleScreen = UNINTERRUPTIBLE.has(segments[0] ?? "");

    useEffect(() => {
        if (!sessionExpired) {
            // armed again, so a later expiry still opens the sheet
            alreadyOpened.current = false;
            return;
        }
        if (alreadyOpened.current || onUninterruptibleScreen) return;

        alreadyOpened.current = true;
        router.push("/reconnect-apple-music");
    }, [sessionExpired, onUninterruptibleScreen, router]);

    return null;
}

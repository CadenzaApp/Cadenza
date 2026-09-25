import { useRouter, useSegments } from "expo-router";
import { useEffect, useRef } from "react";

import { useAppleMusic } from "@/lib/apple-music-auth";

/** Routes that must not be interrupted by the settings sheet. */
const UNINTERRUPTIBLE = new Set(["(splashscreen)", "auth"]);

/**
 * Opens Account settings once when Apple rejects the stored music-user token.
 *
 * Renders nothing. A reconnect needs the settings sheet, and a person who hit
 * this is looking at a library that cannot load, so the sheet is the useful
 * thing to show them. It opens once per expiry, not once per failed read, so a
 * screen firing several reads at once cannot stack sheets or fight navigation.
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
        router.push("/account");
    }, [sessionExpired, onUninterruptibleScreen, router]);

    return null;
}

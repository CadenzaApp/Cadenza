import { Auth } from "@apple-musickit";
import useSWR from "swr";

import { useAppleMusic } from "./apple-music-auth";
import {
    canUse,
    musicTier,
    type MusicFeature,
    type MusicTier,
} from "./music-access";
import { deviceKey } from "./swr-utils";

/**
 * The current music tier, and `can(feature)` for gates. The subscription is
 * read once per Apple Music session.
 */
export function useMusicAccess(): {
    tier: MusicTier;
    can: (feature: MusicFeature) => boolean;
} {
    const { isConnected, sessionRevision } = useAppleMusic();
    // the last answer stands while a new session's loads: unknown reads as
    // full, and flipping a non-subscriber to full for that moment swaps the
    // player engine and drops their queue
    const { data: subscription } = useSWR(
        isConnected ? deviceKey("Auth.getSubscription", sessionRevision) : null,
        () => Auth.getSubscription(),
        { keepPreviousData: true },
    );
    const tier = musicTier({
        isConnected,
        canPlayCatalogContent: subscription?.canPlayCatalogContent,
    });
    return { tier, can: (feature) => canUse(tier, feature) };
}

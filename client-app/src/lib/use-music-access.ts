import { Auth } from "@apple-musickit";
import useSWR from "swr";

import { useAppleMusic } from "./apple-music-auth";
import {
    canUse,
    musicTier,
    type MusicFeature,
    type MusicTier,
} from "./music-access";

/**
 * The current music tier, and `can(feature)` for gates. The subscription is
 * read once per Apple Music session.
 */
export function useMusicAccess(): {
    tier: MusicTier;
    can: (feature: MusicFeature) => boolean;
} {
    const { isConnected, sessionRevision } = useAppleMusic();
    const { data: subscription } = useSWR(
        isConnected ? ["Auth.getSubscription", sessionRevision] : null,
        () => Auth.getSubscription(),
    );
    const tier = musicTier({
        isConnected,
        canPlayCatalogContent: subscription?.canPlayCatalogContent,
    });
    return { tier, can: (feature) => canUse(tier, feature) };
}

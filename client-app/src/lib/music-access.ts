/**
 * What someone can do with music, by how they are connected. The one table
 * every gate in the app reads, so a new feature is one line here.
 *
 * - `preview`: no Apple Music. The catalog works on Cadenza's own developer
 *   token, so search, artists, albums, tagging, and 30 second previews.
 * - `connected`: Apple Music connected without a subscription. Their library
 *   and playlists too, but Apple still only allows previews.
 * - `full`: connected with a subscription. Everything.
 */
export type MusicTier = "preview" | "connected" | "full";

export type MusicFeature =
    | "catalog"
    | "library"
    | "playlists"
    | "favorites"
    | "sync"
    | "fullPlayback";

const TIER_RANK: Record<MusicTier, number> = {
    preview: 0,
    connected: 1,
    full: 2,
};

const MINIMUM_TIER: Record<MusicFeature, MusicTier> = {
    catalog: "preview",
    library: "connected",
    playlists: "connected",
    favorites: "connected",
    sync: "connected",
    fullPlayback: "full",
};

export function musicTier({
    isConnected,
    canPlayCatalogContent,
}: {
    isConnected: boolean;
    /** Undefined while loading or when the platform cannot say. */
    canPlayCatalogContent: boolean | undefined;
}): MusicTier {
    if (!isConnected) return "preview";
    // unknown counts as able: a subscriber should never see previews while
    // the check loads, and Android cannot check at all
    return canPlayCatalogContent === false ? "connected" : "full";
}

export function canUse(tier: MusicTier, feature: MusicFeature): boolean {
    return TIER_RANK[tier] >= TIER_RANK[MINIMUM_TIER[feature]];
}

/** What the next tier up needs, for a gate to say. */
export function unlockAction(feature: MusicFeature): "connect" | "subscribe" {
    return MINIMUM_TIER[feature] === "full" ? "subscribe" : "connect";
}

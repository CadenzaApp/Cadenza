import { useCallback, useEffect, useMemo, useState } from "react";

import { useArtworkTint } from "@/lib/artwork-color";
import { useTracksForSongIds } from "@/lib/musickit-hooks";
import type { AnalyticsSummary } from "@/lib/routes/analytics";

import { formatUpdatedAgo } from "./format";

/**
 * The color the page washes itself with: the most played tag's, since tags are
 * the point of the app, or the #1 song's artwork when nothing played was
 * tagged. Null when there is neither, and the page renders untinted.
 */
export function usePageTint(summary?: AnalyticsSummary): string | null {
    const topTag = summary?.top_tags[0];
    const topSongId = summary?.top.song?.[0]?.sample_song_id;
    const songIds = useMemo(
        () => (!topTag && topSongId ? [topSongId] : NO_IDS),
        [topSongId, topTag],
    );
    const { tracks } = useTracksForSongIds(songIds);
    const { tint } = useArtworkTint(tracks[0]);
    return topTag?.color ?? tint;
}

const NO_IDS: string[] = [];

/** How many colors the page's nebula glows in. */
const NEBULA_COLORS = 5;
const NO_COLORS: string[] = [];

/**
 * The colors of the page's nebula: the period's top tags, most played first,
 * or just the page tint when nothing played was tagged.
 */
export function useNebulaColors(
    summary: AnalyticsSummary | undefined,
    tint: string | null,
): readonly string[] {
    const tags = summary?.top_tags;
    return useMemo(() => {
        if (tags && tags.length > 0)
            return tags.slice(0, NEBULA_COLORS).map((tag) => tag.color);
        return tint ? [tint] : NO_COLORS;
    }, [tags, tint]);
}

/** How often the "Updated" line re-reads the clock. */
const TICK_MS = 30_000;

/**
 * "just now", "5m ago": how long since the last fetch landed, or null before
 * the first. Hand `markUpdated` to the read's `onSuccess`, so it is set from a
 * callback rather than by watching the data in an effect.
 */
export function useUpdatedAgo() {
    const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
    const [now, setNow] = useState(() => new Date());

    const markUpdated = useCallback(() => {
        const at = new Date();
        setUpdatedAt(at);
        setNow(at);
    }, []);

    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), TICK_MS);
        return () => clearInterval(timer);
    }, []);

    return {
        updatedAgo: updatedAt ? formatUpdatedAgo(updatedAt, now) : null,
        markUpdated,
    };
}

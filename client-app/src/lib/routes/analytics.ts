import { useAPIData } from "../api-actions";
import type { Tag } from "@/lib/types";

/** A flat bag of counts. Keys come from the backend's metric registry. */
export type AnalyticsStats = Record<string, number>;

/**
 * One row of a ranking, whatever it is a ranking of.
 *
 * `label` is null for songs: Apple Music owns song titles and the backend never
 * stores one, so the client resolves those from `sample_song_id`. That same id
 * is how every row gets its artwork, in one batch.
 */
export type EntityPlayCount = {
    key: string;
    label: string | null;
    sub_label: string | null;
    /** The id needed to open it, when any play recorded one. */
    entity_id: string | null;
    sample_song_id: string;
    plays: number;
};

/**
 * A tag and its plays. The whole tag, so `TagPill` can draw it directly.
 * `sample_song_id` is its most played song in the window, for a cover.
 */
export type TagPlayCount = Tag & { plays: number; sample_song_id: string };

/** A song the user put on repeat, and how hard. */
export type SongReplayCount = {
    song_id: string;
    /** The most plays it got inside one listening session. */
    most_in_one_session: number;
    plays: number;
};

export type AnalyticsSummary = {
    stats: AnalyticsStats;
    rates: Record<string, number>;
    active_days: number;
    /** Distinct tags on songs played in the window. Not capped like `top_tags`. */
    tags_played: number;
    /** 24 entries, index 0 is midnight in the requested timezone. */
    plays_by_hour: number[];
    /** A ranking per dimension, keyed by its name. Built from the registry. */
    top: Record<string, EntityPlayCount[]>;
    top_tags: TagPlayCount[];
    most_replayed: SongReplayCount[];
};

/** What a ranking can be grouped by. */
export type TopDimension = "song" | "playlist" | "album" | "artist" | "query";

export type AnalyticsTopList = {
    dimension: TopDimension;
    description: string;
    entries: EntityPlayCount[];
};

export type AnalyticsTopTags = { entries: TagPlayCount[] };

/** A bucket size the backend answers with. */
export type TrendBucketSize = "hour" | "day" | "week" | "month" | "year";

/** The window every read on this page shares. */
export type AnalyticsWindow = { since?: string; until?: string };

/**
 * The device's IANA timezone, which is what the backend cuts day, week, month
 * and hour boundaries in. Without it a week is a UTC week, which is the wrong
 * week for most of the world.
 */
export function deviceTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}

/**
 * The query params every analytics read shares. Undefined bounds are left out
 * rather than sent as undefined, so an all-time read has a stable cache key.
 */
export function windowParams(window?: AnalyticsWindow) {
    return {
        tz: deviceTimezone(),
        ...(window?.since ? { since: window.since } : {}),
        ...(window?.until ? { until: window.until } : {}),
    };
}

/**
 * `GET /analytics/summary`. Every count the overview shows, in one request.
 *
 * A user with no events gets zeros and empty lists, not an error. `onSuccess`
 * runs after each fetch that lands, for a caller showing when it last updated.
 */
export function useAnalyticsSummary(
    window?: AnalyticsWindow,
    onSuccess?: (summary: AnalyticsSummary) => void,
) {
    const x = useAPIData<AnalyticsSummary>(
        "/analytics/summary",
        windowParams(window),
        { keepPreviousData: true, onSuccess, save: true },
    );
    return {
        summary: x.data,
        summaryLoading: x.isLoading,
        summaryErr: x.error,
    };
}

/** `GET /analytics/top`. A full ranking for one dimension. */
export function useAnalyticsTop(
    dimension: TopDimension | undefined,
    window?: AnalyticsWindow,
    limit?: number,
) {
    const x = useAPIData<AnalyticsTopList>(
        "/analytics/top",
        {
            dimension,
            ...windowParams(window),
            ...(limit ? { limit } : {}),
        },
        { keepPreviousData: true, save: true },
    );
    return {
        top: x.data,
        topLoading: x.isLoading,
        topErr: x.error,
    };
}

/** What a heatmap cell's tag carries: enough to color it and name it. */
export type HeatmapTag = { id: number; name: string; color: string };

export type AnalyticsHeatmap = {
    /** `two_hour` is heatmap only: two hours from an even local hour. */
    bucket: TrendBucketSize | "two_hour";
    /**
     * Sparse: only buckets with a play. `start` is the local bucket start,
     * `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MI` for an hour.
     */
    cells: { start: string; plays: number; tag_id: number | null }[];
    /** Every tag a cell names, once. */
    tags: HeatmapTag[];
};

/**
 * `GET /analytics/heatmap`. Plays per bucket, each with its most played tag.
 * The key covers the bucket and the window.
 *
 * Does not keep the previous window's data while a new one loads: the heatmap
 * card drills between windows cut in the same bucket, where old cells would
 * land on the wrong squares.
 */
export function useAnalyticsHeatmap(bucket: string, window?: AnalyticsWindow) {
    const x = useAPIData<AnalyticsHeatmap>(
        "/analytics/heatmap",
        { bucket, ...windowParams(window) },
        { save: true },
    );
    return {
        heatmap: x.data,
        heatmapLoading: x.isLoading,
        heatmapErr: x.error,
    };
}

/** A tag and the listening time on songs carrying it. */
export type TagListeningTime = Tag & { listening_ms: number };

export type AnalyticsTagShares = {
    /** The window's listening time, each listen once. */
    total_ms: number;
    /** The part of it on songs with any of the tags, each listen once. */
    tagged_ms: number;
    /**
     * Most listened first, the user's own tags only. A listen counts in full
     * toward every tag on its song, so these can sum past `total_ms`.
     */
    tags: TagListeningTime[];
};

/**
 * `GET /analytics/tag-shares`. Each tag's share of a window's listening time.
 * Keeps the last window's tags while a new one loads, so a list that follows
 * the user's taps swaps in place rather than emptying between them.
 */
export function useAnalyticsTagShares(window?: AnalyticsWindow) {
    const x = useAPIData<AnalyticsTagShares>(
        "/analytics/tag-shares",
        windowParams(window),
        { save: true, keepPreviousData: true },
    );
    return {
        tagShares: x.data,
        tagSharesLoading: x.isLoading,
        tagSharesErr: x.error,
    };
}

/** `GET /analytics/top-tags`. The tags the user listens to, over a window. */
export function useAnalyticsTopTags(window?: AnalyticsWindow, limit?: number) {
    const x = useAPIData<AnalyticsTopTags>(
        "/analytics/top-tags",
        { ...windowParams(window), ...(limit ? { limit } : {}) },
        { keepPreviousData: true, save: true },
    );
    return {
        topTags: x.data,
        topTagsLoading: x.isLoading,
        topTagsErr: x.error,
    };
}

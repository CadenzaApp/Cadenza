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

/** A tag and its plays. The whole tag, so `TagPill` can draw it directly. */
export type TagPlayCount = Tag & { plays: number };

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
    /** 24 entries, index 0 is midnight in the requested timezone. */
    plays_by_hour: number[];
    /** A ranking per dimension, keyed by its name. Built from the registry. */
    top: Record<string, EntityPlayCount[]>;
    top_tags: TagPlayCount[];
    most_replayed: SongReplayCount[];
};

/** What a ranking can be grouped by. */
export type TopDimension = "song" | "artist" | "album";

export type AnalyticsTopList = {
    dimension: TopDimension;
    description: string;
    entries: EntityPlayCount[];
};

export type AnalyticsTopTags = { entries: TagPlayCount[] };

/**
 * What the trends endpoint answers with. Never `auto`: the server resolved it.
 *
 * `TrendBucket` in `features/analytics/range.ts` is this plus `auto`, which is a
 * request-only value.
 */
export type TrendBucketSize = "day" | "week" | "month" | "year";

/** What a metric's number means, so it can be formatted without a lookup table. */
export type MetricUnit = "count" | "milliseconds";

export type AnalyticsTrend = {
    metric: string;
    description: string;
    unit: MetricUnit;
    bucket: TrendBucketSize;
    /** Dense: one point per bucket, zero where nothing happened. */
    points: { bucket: string; value: number }[];
};

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
function windowParams(window?: AnalyticsWindow) {
    return {
        tz: deviceTimezone(),
        ...(window?.since ? { since: window.since } : {}),
        ...(window?.until ? { until: window.until } : {}),
    };
}

/**
 * `GET /analytics/summary`. Every count the overview shows, in one request.
 *
 * A user with no events gets zeros and empty lists, not an error.
 */
export function useAnalyticsSummary(window?: AnalyticsWindow) {
    const x = useAPIData<AnalyticsSummary>(
        "/analytics/summary",
        windowParams(window),
        { keepPreviousData: true },
    );
    return {
        summary: x.data,
        summaryLoading: x.isLoading,
        summaryErr: x.error,
    };
}

/**
 * `GET /analytics/trends`. One metric bucketed over time.
 *
 * The key covers the metric, the bucket and the window, so changing any of them
 * reads its own cache entry. `enabled` is how the Today range skips the request
 * altogether, since it shows the hours histogram instead.
 */
export function useAnalyticsTrend(
    metric: string | undefined,
    bucket: string,
    window?: AnalyticsWindow,
    enabled = true,
) {
    const x = useAPIData<AnalyticsTrend>(
        "/analytics/trends",
        { metric, bucket, ...windowParams(window) },
        { keepPreviousData: true, enabled },
    );
    return {
        trend: x.data,
        trendLoading: x.isLoading,
        trendErr: x.error,
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
        { keepPreviousData: true },
    );
    return {
        top: x.data,
        topLoading: x.isLoading,
        topErr: x.error,
    };
}

/** `GET /analytics/top-tags`. The tags the user listens to, over a window. */
export function useAnalyticsTopTags(window?: AnalyticsWindow, limit?: number) {
    const x = useAPIData<AnalyticsTopTags>(
        "/analytics/top-tags",
        { ...windowParams(window), ...(limit ? { limit } : {}) },
        { keepPreviousData: true },
    );
    return {
        topTags: x.data,
        topTagsLoading: x.isLoading,
        topTagsErr: x.error,
    };
}

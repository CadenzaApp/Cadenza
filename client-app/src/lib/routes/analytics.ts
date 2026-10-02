import { useAPIData } from "../api-actions";

/** A flat bag of counts. Keys come from the backend's metric registry. */
export type AnalyticsStats = Record<string, number>;

export type SongPlayCount = { song_id: string; plays: number };
export type TagPlayCount = { name: string; color: string; plays: number };
export type SongReplayCount = {
    song_id: string;
    most_in_one_session: number;
    plays: number;
};

export type AnalyticsSummary = {
    stats: AnalyticsStats;
    rates: Record<string, number>;
    active_days: number;
    /** 24 entries, index 0 is midnight in the requested timezone. */
    plays_by_hour: number[];
    top_songs: SongPlayCount[];
    top_tags: TagPlayCount[];
    most_replayed: SongReplayCount[];
    window: { since: string | null; until: string | null };
};

export type TrendBucketSize = "day" | "week" | "month" | "year";

export type AnalyticsTrend = {
    metric: string;
    description: string;
    bucket: TrendBucketSize;
    /** Dense: one point per bucket, zero where nothing happened. */
    points: { bucket: string; value: number }[];
};

export type MetricInfo = { name: string; description: string };

/**
 * The device's IANA timezone, which is what the backend cuts day, week, and hour
 * boundaries in. Without it a week is a UTC week, which is the wrong week for
 * most of the world.
 */
export function deviceTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}

/**
 * `GET /analytics/summary`. Every count the analytics page shows.
 *
 * `since` and `until` are ISO strings; leaving both out reads all time. A user
 * with no events gets zeros, not an error.
 */
export function useAnalyticsSummary(params?: {
    since?: string;
    until?: string;
}) {
    const x = useAPIData<AnalyticsSummary>("/analytics/summary", {
        tz: deviceTimezone(),
        ...(params?.since ? { since: params.since } : {}),
        ...(params?.until ? { until: params.until } : {}),
    });
    return {
        summary: x.data,
        summaryLoading: x.isLoading,
        summaryErr: x.error,
    };
}

/**
 * `GET /analytics/trends`. One metric bucketed over time.
 *
 * The key covers the metric and the bucket, so switching either reads its own
 * cache entry instead of showing the previous series.
 */
export function useAnalyticsTrend(
    metric: string | undefined,
    bucket: TrendBucketSize,
) {
    const x = useAPIData<AnalyticsTrend>(
        "/analytics/trends",
        { metric, bucket, tz: deviceTimezone() },
        { keepPreviousData: true },
    );
    return {
        trend: x.data,
        trendLoading: x.isLoading,
        trendErr: x.error,
    };
}

/** `GET /analytics/metrics`. What the trends endpoint can chart. */
export function useAnalyticsMetrics() {
    const x = useAPIData<MetricInfo[]>("/analytics/metrics");
    return {
        metrics: x.data,
        metricsLoading: x.isLoading,
        metricsErr: x.error,
    };
}

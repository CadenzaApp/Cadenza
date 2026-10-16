import type { APIDataEndpoint } from "../api-endpoints";

/** Event writes and tag membership changes affect all analytics snapshots. */
export const ANALYTICS_READS: readonly APIDataEndpoint[] = [
    { path: "/analytics/summary" },
    { path: "/analytics/top" },
    { path: "/analytics/top-tags" },
    { path: "/analytics/heatmap" },
    { path: "/analytics/tag-shares" },
    { path: "/analytics/listening" },
    { path: "/analytics/sessions" },
    { path: "/analytics/session-songs" },
];

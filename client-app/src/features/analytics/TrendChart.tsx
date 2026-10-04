import { View } from "react-native";

import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import type { AnalyticsTrend, TrendBucketSize } from "@/lib/routes/analytics";

import { AnalyticsCard } from "./AnalyticsCard";
import { BarChart, type Bar } from "./BarChart";
import { ChipRow } from "./ChipRow";
import { formatBucket, formatMetric } from "./format";

/**
 * The three metrics the overview chart offers.
 *
 * Deliberately not the whole registry: it is eight entries and the chip row sits
 * above the fold. The rest stay queryable through `/analytics/trends` by name.
 */
export const HEADLINE_METRICS = ["plays", "listening_ms", "skips"] as const;
export type HeadlineMetric = (typeof HEADLINE_METRICS)[number];

const METRIC_LABELS: Record<HeadlineMetric, string> = {
    plays: "Plays",
    listening_ms: "Time",
    skips: "Skips",
};

type Props = {
    trend?: AnalyticsTrend;
    loading: boolean;
    error?: unknown;
    metric: HeadlineMetric;
    onMetricChange: (metric: HeadlineMetric) => void;
    color?: string | null;
};

/** One metric over the selected range, as bars. */
export function TrendChart({
    trend,
    loading,
    error,
    metric,
    onMetricChange,
    color,
}: Props) {
    // labelled and formatted off what the response was computed with, not what
    // is selected: keepPreviousData holds the old series while a new request is
    // in flight or has failed, and using the new selection would relabel a
    // monthly series as days and a duration as a count
    const shownBucket: TrendBucketSize = trend?.bucket ?? "day";
    const unit = trend?.unit ?? "count";
    const bars: Bar[] =
        trend?.points.map((point) => ({
            label: formatBucket(point.bucket, shownBucket),
            value: point.value,
            readout: `${formatBucket(point.bucket, shownBucket)}: ${formatMetric(point.value, unit)}`,
        })) ?? [];

    return (
        <AnalyticsCard>
            <View className="gap-1">
                <Text role="heading" className="text-lg font-semibold">
                    {trend?.description ?? "Over time"}
                </Text>
                <Text className="text-muted-foreground text-xs">
                    Tap a bar for its value.
                </Text>
            </View>

            <ChipRow
                options={HEADLINE_METRICS}
                selected={metric}
                onSelect={onMetricChange}
                labelOf={(name) => METRIC_LABELS[name]}
            />

            {loading && bars.length === 0 ? (
                <Skeleton className="h-36 w-full" />
            ) : (
                <BarChart
                    bars={bars}
                    maxLabels={shownBucket === "day" ? 4 : 5}
                    color={color}
                />
            )}

            {error ? (
                <Text className="text-muted-foreground text-xs">
                    Could not load that view.
                </Text>
            ) : null}
        </AnalyticsCard>
    );
}

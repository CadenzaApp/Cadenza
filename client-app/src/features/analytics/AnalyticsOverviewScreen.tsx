import { useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";

import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { NebulaBackdrop } from "@/components/ui/nebula-backdrop";
import {
    useAnalyticsSummary,
    useAnalyticsTrend,
    type AnalyticsSummary,
    type AnalyticsTrend,
    type EntityPlayCount,
} from "@/lib/routes/analytics";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";

import { AnalyticsCard } from "./AnalyticsCard";
import { AnalyticsHeader } from "./AnalyticsHeader";
import { useNebulaColors, usePageTint, useUpdatedAgo } from "./analytics-hooks";
import { useAnalyticsPeriod } from "./analytics-period";
import { dimensionByName, type DimensionDescriptor } from "./dimensions";
import { formatCount, formatDuration } from "./format";
import { Heatmap } from "./Heatmap";
import { HeroCarousel } from "./HeroCarousel";
import { HoursChart } from "./HoursChart";
import type { ResolvedPeriod } from "./range";
import { SectionHeading } from "./SectionHeading";
import { StatsStrip } from "./StatsStrip";
import { TagRotation } from "./TagRotation";
import { TopEntityList } from "./TopEntityList";
import { TopRankingsCard } from "./TopRankingsCard";
import { TrendChart, type HeadlineMetric } from "./TrendChart";

/**
 * What the user's listening looks like over one calendar period, from the
 * backend's event log.
 *
 * Every number here is computed in SQL; this screen formats and lays out. The
 * period comes from `AnalyticsPeriodProvider`, which lives in the tab's layout
 * so it survives navigating into a detail page.
 *
 * Top to bottom: the header, the #1 hero, the stats strip, the heatmap, the tag
 * rail, then the trend chart and the rankings. Behind it all glows a nebula
 * in the period's top tag colors.
 */
export function AnalyticsOverviewScreen() {
    const { contentBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll();
    const { period } = useAnalyticsPeriod();
    const [metric, setMetric] = useState<HeadlineMetric>("plays");

    const window = { since: period.since, until: period.until };
    const { updatedAgo, markUpdated } = useUpdatedAgo();
    const { summary, summaryLoading, summaryErr } = useAnalyticsSummary(
        window,
        markUpdated,
    );
    // the hours chart reads plays_by_hour off the summary, so a day needs no
    // trend request at all
    const { trend, trendLoading, trendErr } = useAnalyticsTrend(
        metric,
        period.trendBucket,
        window,
        period.chart === "trend",
    );

    const accent = usePageTint(summary);
    const nebula = useNebulaColors(summary, accent);

    return (
        <View className="flex-1 bg-background">
            {/* fixed to the screen, so the page slides over it, overscroll
                included */}
            <NebulaBackdrop colors={nebula} />
            {/* the marker takes the scroller alone: it allows one direct child,
                and a layout-only wrapper flattens away */}
            <ScreenScrollMarker>
                <Animated.ScrollView
                    {...scroll}
                    className="flex-1"
                    contentContainerClassName="gap-6 px-5"
                    contentContainerStyle={[
                        { paddingTop: 16, paddingBottom: contentBottomInset },
                        scroll.contentContainerStyle,
                    ]}
                    showsVerticalScrollIndicator={false}
                >
                    <AnalyticsHeader
                        accent={accent}
                        updatedAgo={updatedAgo}
                        offline={Boolean(summaryErr)}
                    />

                    {/* data wins over an error, so a dropped connection
                        keeps the last page rather than blanking it */}
                    {summary ? (
                        <OverviewBody
                            summary={summary}
                            period={period}
                            accent={accent}
                            trend={trend}
                            trendLoading={trendLoading}
                            trendErr={trendErr}
                            metric={metric}
                            onMetricChange={setMetric}
                        />
                    ) : summaryErr ? (
                        <Message
                            title="Could not load your listening"
                            detail="Pull down to try again once you are back online."
                        />
                    ) : summaryLoading ? (
                        <LoadingState />
                    ) : null}
                </Animated.ScrollView>
            </ScreenScrollMarker>
        </View>
    );
}

/**
 * The page under the header, once there is something to show.
 *
 * A period with no plays gets its own message rather than a page of zeros,
 * because a wall of zeros reads as broken. The header stays above it, so the
 * user can still step to a period that has some.
 */
function OverviewBody({
    summary,
    period,
    accent,
    trend,
    trendLoading,
    trendErr,
    metric,
    onMetricChange,
}: {
    summary: AnalyticsSummary;
    period: ResolvedPeriod;
    accent: string | null;
    trend?: AnalyticsTrend;
    trendLoading: boolean;
    trendErr?: unknown;
    metric: HeadlineMetric;
    onMetricChange: (metric: HeadlineMetric) => void;
}) {
    const { stats } = summary;
    const periodKey = `${period.grain}:${period.since ?? "all"}`;

    if ((stats.plays ?? 0) === 0) {
        return (
            <Message
                title={
                    period.grain === "all"
                        ? "Nothing played yet"
                        : `Nothing played ${period.phrase}`
                }
                detail="Play some music and it will show up here. A song counts once it has played for 15 seconds."
            />
        );
    }

    return (
        <>
            {/* keyed by period, so a new one starts back on #1 and a fresh
                grid with nothing selected or opened */}
            <HeroCarousel
                key={`hero:${periodKey}`}
                songs={summary.top.song ?? NO_ENTRIES}
                phrase={period.phrase}
                accent={accent}
            />

            <StatsStrip
                accent={accent}
                stats={[
                    {
                        icon: "headset",
                        value: formatDuration(stats.listening_ms ?? 0),
                        label: "listened",
                    },
                    {
                        icon: "musical-notes",
                        value: formatCount(stats.unique_songs ?? 0),
                        label: "songs",
                    },
                    {
                        icon: "pricetags",
                        value: formatCount(summary.tags_played),
                        label: "tags",
                    },
                ]}
            />

            <Heatmap
                key={`heatmap:${periodKey}`}
                root={period}
                accent={accent}
            />

            <TagRotation tags={summary.top_tags} />

            {period.chart === "hours" ? (
                <HoursChart
                    playsByHour={summary.plays_by_hour}
                    color={accent}
                />
            ) : (
                <TrendChart
                    trend={trend}
                    loading={trendLoading}
                    error={trend ? undefined : trendErr}
                    metric={metric}
                    onMetricChange={onMetricChange}
                    color={accent}
                    perYear={period.grain === "all"}
                />
            )}

            <TopRankingsCard top={summary.top} accent={accent} />

            {summary.most_replayed.length > 0 ? (
                <AnalyticsCard>
                    <SectionHeading
                        title="On repeat"
                        detail="Most plays in one sitting."
                    />
                    <TopEntityList
                        dimension={REPLAY_DIMENSION}
                        entries={summary.most_replayed.map(
                            (song): EntityPlayCount => ({
                                key: song.song_id,
                                label: null,
                                sub_label: null,
                                entity_id: song.song_id,
                                sample_song_id: song.song_id,
                                // the figure on the row is the sitting, not
                                // a total; the subtitle says so
                                plays: song.most_in_one_session,
                            }),
                        )}
                    />
                </AnalyticsCard>
            ) : null}
        </>
    );
}

function Message({ title, detail }: { title: string; detail: string }) {
    return (
        <AnalyticsCard className="gap-2">
            <Text className="text-lg font-semibold">{title}</Text>
            <Text className="text-muted-foreground text-sm">{detail}</Text>
        </AnalyticsCard>
    );
}

function LoadingState() {
    return (
        <>
            <View className="items-center gap-4">
                <Skeleton className="h-56 w-56 rounded-2xl" />
                <Skeleton className="h-8 w-48 rounded" />
            </View>
            <Skeleton className="h-24 w-full rounded-3xl" />
            <Skeleton className="h-48 w-full rounded-3xl" />
            <View className="flex-row gap-3">
                <Skeleton className="h-36 w-36 rounded-2xl" />
                <Skeleton className="h-36 w-36 rounded-2xl" />
            </View>
        </>
    );
}

/** Stable, so a pending read does not give the list a new array each render. */
const NO_ENTRIES: EntityPlayCount[] = [];

/**
 * On repeat is a ranking of songs, so it borrows the song descriptor's drawing
 * rules. Its figure is the most plays in one sitting, not a total.
 */
const REPLAY_DIMENSION: DimensionDescriptor = {
    ...(dimensionByName("song") as DimensionDescriptor),
    emptyLabel: "Nothing played twice in a row yet.",
};

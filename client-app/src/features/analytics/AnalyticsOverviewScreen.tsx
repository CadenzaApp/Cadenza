import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";

import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import {
    useAnalyticsSummary,
    useAnalyticsTrend,
    type AnalyticsSummary,
    type EntityPlayCount,
} from "@/lib/routes/analytics";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";

import { useAnalyticsRange } from "./analytics-range";
import {
    DIMENSIONS,
    dimensionByName,
    type DimensionDescriptor,
} from "./dimensions";
import { formatCount, formatDuration, formatPercent } from "./format";
import { HoursChart } from "./HoursChart";
import { RangeChips } from "./RangeChips";
import { StatTile } from "./StatTile";
import { TopEntityList } from "./TopEntityList";
import { TopTagList } from "./TopTagList";
import { TrendChart, type HeadlineMetric } from "./TrendChart";

/** How many rows a preview card shows before "See all". */
const PREVIEW_COUNT = 5;

/**
 * What the user's listening looks like, from the backend's event log.
 *
 * Every number here is computed in SQL; this screen formats and lays out. The
 * time range comes from `AnalyticsRangeProvider`, which lives in the tab's
 * layout so it survives navigating into a detail page.
 */
export function AnalyticsOverviewScreen() {
    const { contentBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll();
    const { resolved } = useAnalyticsRange();
    const [metric, setMetric] = useState<HeadlineMetric>("plays");

    const window = { since: resolved.since, until: resolved.until };
    const { summary, summaryLoading, summaryErr } = useAnalyticsSummary(window);
    // the hours chart reads plays_by_hour off the summary, so Today needs no
    // trend request at all
    const { trend, trendLoading, trendErr } = useAnalyticsTrend(
        metric,
        resolved.bucket,
        window,
        resolved.chart === "trend",
    );

    return (
        <ScreenScrollMarker>
            <View className="flex-1 bg-background">
                {/* above the scroll view on purpose: a filter driving the page
                    should stay reachable without scrolling back up */}
                <View className="px-5 pt-5">
                    <RangeChips />
                </View>
                <Animated.ScrollView
                    {...scroll}
                    className="flex-1"
                    contentContainerClassName="gap-4 px-5 pt-4"
                    contentContainerStyle={{
                        paddingBottom: contentBottomInset,
                    }}
                    showsVerticalScrollIndicator={false}
                >
                    {summaryErr ? (
                        <Message
                            title="Could not load your listening"
                            detail="Pull down to try again once you are back online."
                        />
                    ) : summaryLoading && !summary ? (
                        <LoadingState />
                    ) : summary ? (
                        <OverviewBody
                            summary={summary}
                            rangeLabel={resolved.label}
                            chart={resolved.chart}
                            trend={trend}
                            trendLoading={trendLoading}
                            trendErr={trendErr}
                            metric={metric}
                            onMetricChange={setMetric}
                        />
                    ) : null}
                </Animated.ScrollView>
            </View>
        </ScreenScrollMarker>
    );
}

/**
 * The page itself, once there is something to show.
 *
 * A new account gets its own empty state rather than a page of zeros, because a
 * wall of zeros reads as broken.
 */
function OverviewBody({
    summary,
    rangeLabel,
    chart,
    trend,
    trendLoading,
    trendErr,
    metric,
    onMetricChange,
}: {
    summary: AnalyticsSummary;
    rangeLabel: string;
    chart: "hours" | "trend";
    trend?: Parameters<typeof TrendChart>[0]["trend"];
    trendLoading: boolean;
    trendErr?: unknown;
    metric: HeadlineMetric;
    onMetricChange: (metric: HeadlineMetric) => void;
}) {
    const { stats, rates } = summary;

    if ((stats.plays ?? 0) === 0) {
        return (
            <Message
                title={`Nothing played ${rangeLabel.toLowerCase()}`}
                detail="Play some music and it will show up here. A song counts once it has played for 15 seconds."
            />
        );
    }

    return (
        <>
            <View className="flex-row gap-3">
                <StatTile label="Plays" value={formatCount(stats.plays ?? 0)} />
                <StatTile
                    label="Listening time"
                    value={formatDuration(stats.listening_ms ?? 0)}
                />
            </View>
            <View className="flex-row gap-3">
                <StatTile
                    label="Skips"
                    value={formatCount(stats.skips ?? 0)}
                    hint={`${formatPercent(rates.skip_rate ?? 0)} of finished listens`}
                />
                <StatTile
                    label="Songs"
                    value={formatCount(stats.unique_songs ?? 0)}
                    hint={`over ${formatCount(summary.active_days)} days`}
                />
            </View>
            <View className="flex-row gap-3">
                <StatTile
                    label="Finished"
                    value={formatCount(stats.completions ?? 0)}
                    hint={`${formatPercent(rates.completion_rate ?? 0)} of listens`}
                />
                <StatTile
                    label="From a query"
                    value={formatCount(stats.query_plays ?? 0)}
                    hint={`${formatPercent(rates.query_play_rate ?? 0)} of plays`}
                />
            </View>

            {chart === "hours" ? (
                <HoursChart playsByHour={summary.plays_by_hour} />
            ) : (
                <TrendChart
                    trend={trend}
                    loading={trendLoading}
                    error={trendErr}
                    metric={metric}
                    onMetricChange={onMetricChange}
                />
            )}

            {DIMENSIONS.map((dimension) => (
                <PreviewCard
                    key={dimension.name}
                    dimension={dimension}
                    entries={summary.top[dimension.name] ?? NO_ENTRIES}
                />
            ))}

            <Card>
                <CardContent className="gap-4">
                    <CardHeading
                        title="Tags you listen to"
                        detail="Plays of songs carrying each tag."
                        href="/analytics/tags"
                    />
                    <TopTagList
                        tags={summary.top_tags.slice(0, PREVIEW_COUNT)}
                        emptyLabel="Tag some songs and play them to see this."
                    />
                </CardContent>
            </Card>

            {summary.most_replayed.length > 0 ? (
                <Card>
                    <CardContent className="gap-4">
                        <View className="gap-1">
                            <CardTitle>On repeat</CardTitle>
                            <Text className="text-muted-foreground text-xs">
                                Most plays in one sitting.
                            </Text>
                        </View>
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
                                    // a total; the card's subtitle says so
                                    plays: song.most_in_one_session,
                                }),
                            )}
                        />
                    </CardContent>
                </Card>
            ) : null}
        </>
    );
}

/** A top-5 preview with a link to the full list. */
function PreviewCard({
    dimension,
    entries,
}: {
    dimension: DimensionDescriptor;
    entries: readonly EntityPlayCount[];
}) {
    return (
        <Card>
            <CardContent className="gap-4">
                <CardHeading
                    title={dimension.previewTitle}
                    href={{
                        pathname: "/analytics/[dimension]",
                        params: { dimension: dimension.name },
                    }}
                />
                <TopEntityList
                    dimension={dimension}
                    entries={entries.slice(0, PREVIEW_COUNT)}
                />
            </CardContent>
        </Card>
    );
}

function CardHeading({
    title,
    detail,
    href,
}: {
    title: string;
    detail?: string;
    href: Href;
}) {
    const router = useRouter();
    return (
        <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1 gap-1">
                <CardTitle>{title}</CardTitle>
                {detail ? (
                    <Text className="text-muted-foreground text-xs">
                        {detail}
                    </Text>
                ) : null}
            </View>
            <Pressable
                onPress={() => router.push(href)}
                accessibilityRole="button"
                accessibilityLabel={`See all ${title.toLowerCase()}`}
            >
                <Text className="text-muted-foreground text-xs">See all</Text>
            </Pressable>
        </View>
    );
}

function Message({ title, detail }: { title: string; detail: string }) {
    return (
        <Card>
            <CardContent className="gap-2">
                <CardTitle>{title}</CardTitle>
                <Text className="text-muted-foreground text-sm">{detail}</Text>
            </CardContent>
        </Card>
    );
}

function LoadingState() {
    return (
        <>
            <View className="flex-row gap-3">
                <Skeleton className="h-24 flex-1 rounded-xl" />
                <Skeleton className="h-24 flex-1 rounded-xl" />
            </View>
            <View className="flex-row gap-3">
                <Skeleton className="h-24 flex-1 rounded-xl" />
                <Skeleton className="h-24 flex-1 rounded-xl" />
            </View>
            <Skeleton className="h-56 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
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

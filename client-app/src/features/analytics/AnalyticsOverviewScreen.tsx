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
    type EntityPlayCount,
    type TopDimension,
} from "@/lib/routes/analytics";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";

import { useAnalyticsRange } from "./analytics-range";
import { BarChart, type Bar } from "./BarChart";
import { ChipRow } from "./ChipRow";
import {
    formatBucket,
    formatCount,
    formatDuration,
    formatHour,
    formatPercent,
} from "./format";
import { RangeChips } from "./RangeChips";
import { TopEntityList } from "./TopEntityList";
import { TopTagList } from "./TopTagList";
import { StatTile } from "./StatTile";

/** How many rows a preview card shows before "See all". */
const PREVIEW_COUNT = 5;

/**
 * The three metrics the overview chart offers.
 *
 * Deliberately not the whole registry: it is eight entries and the chip row sits
 * above the fold. The others are still served by `/analytics/metrics` for
 * anything that wants them.
 */
const HEADLINE_METRICS = ["plays", "listening_ms", "skips"] as const;
type HeadlineMetric = (typeof HEADLINE_METRICS)[number];

const METRIC_LABELS: Record<HeadlineMetric, string> = {
    plays: "Plays",
    listening_ms: "Time",
    skips: "Skips",
};

/**
 * What the user's listening looks like, from the backend's event log.
 *
 * Every number here is computed in SQL; this screen formats and lays out. The
 * time range comes from `AnalyticsRangeProvider`, which lives in the tab's
 * layout so it survives navigating into a detail page.
 *
 * A new account gets its own empty state rather than a page of zeros, because a
 * wall of zeros reads as broken.
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

    const body = () => {
        if (summaryErr) {
            return (
                <Message
                    title="Could not load your listening"
                    detail="Pull down to try again once you are back online."
                />
            );
        }
        if (summaryLoading && !summary) return <LoadingState />;
        if (!summary) return null;

        const { stats, rates } = summary;
        if ((stats.plays ?? 0) === 0) {
            return (
                <Message
                    title={`Nothing played ${resolved.label.toLowerCase()}`}
                    detail="Play some music and it will show up here. A song counts once it has played for 15 seconds."
                />
            );
        }

        return (
            <>
                <View className="flex-row gap-3">
                    <StatTile
                        label="Plays"
                        value={formatCount(stats.plays ?? 0)}
                    />
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

                <ChartCard
                    chart={resolved.chart}
                    playsByHour={summary.plays_by_hour}
                    trend={trend}
                    trendLoading={trendLoading}
                    trendErr={trendErr}
                    metric={metric}
                    onMetricChange={setMetric}
                />

                <PreviewCard
                    title="Most played"
                    dimension="song"
                    entries={summary.top_songs}
                    emptyLabel="No plays in this window yet."
                    href="/analytics/songs"
                />
                <PreviewCard
                    title="Most listened artists"
                    dimension="artist"
                    entries={summary.top_artists}
                    emptyLabel="No artists recorded in this window yet."
                    href="/analytics/artists"
                    roundArtwork
                />
                <PreviewCard
                    title="Most listened albums"
                    dimension="album"
                    entries={summary.top_albums}
                    emptyLabel="No albums recorded in this window yet."
                    href="/analytics/albums"
                />

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
                                dimension="song"
                                entries={summary.most_replayed.map(
                                    (song): EntityPlayCount => ({
                                        key: song.song_id,
                                        label: null,
                                        sub_label: null,
                                        entity_id: song.song_id,
                                        sample_song_id: song.song_id,
                                        plays: song.most_in_one_session,
                                    }),
                                )}
                                emptyLabel="Nothing played twice in a row yet."
                            />
                        </CardContent>
                    </Card>
                ) : null}
            </>
        );
    };

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
                    {body()}
                </Animated.ScrollView>
            </View>
        </ScreenScrollMarker>
    );
}

/** The chart, and the metric picker when there is a trend to pick for. */
function ChartCard({
    chart,
    playsByHour,
    trend,
    trendLoading,
    trendErr,
    metric,
    onMetricChange,
}: {
    chart: "hours" | "trend";
    playsByHour: number[];
    trend?: {
        bucket: string;
        description: string;
        points: { bucket: string; value: number }[];
    };
    trendLoading: boolean;
    trendErr?: unknown;
    metric: HeadlineMetric;
    onMetricChange: (metric: HeadlineMetric) => void;
}) {
    if (chart === "hours") {
        const bars: Bar[] = playsByHour.map((plays, hour) => ({
            label: formatHour(hour),
            value: plays,
            readout: `${formatHour(hour)}: ${formatCount(plays)} plays`,
        }));
        return (
            <Card>
                <CardContent className="gap-4">
                    <View className="gap-1">
                        <CardTitle>By hour</CardTitle>
                        <Text className="text-muted-foreground text-xs">
                            Tap a bar for its value.
                        </Text>
                    </View>
                    <BarChart bars={bars} maxLabels={5} height={110} />
                </CardContent>
            </Card>
        );
    }

    // labelled off the bucket the response was computed with, not the range that
    // is selected: keepPreviousData holds the old series while a new request is
    // in flight or has failed, and labelling that with the new range would
    // relabel a monthly series as days
    const shownBucket = (trend?.bucket ?? "day") as
        | "day"
        | "week"
        | "month"
        | "year";
    const bars: Bar[] =
        trend?.points.map((point) => ({
            label: formatBucket(point.bucket, shownBucket),
            value: point.value,
            readout: `${formatBucket(point.bucket, shownBucket)}: ${formatCount(point.value)}`,
        })) ?? [];

    return (
        <Card>
            <CardContent className="gap-4">
                <View className="gap-1">
                    <CardTitle>{trend?.description ?? "Over time"}</CardTitle>
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

                {trendLoading && bars.length === 0 ? (
                    <Skeleton className="h-36 w-full" />
                ) : (
                    <BarChart
                        bars={bars}
                        maxLabels={shownBucket === "day" ? 4 : 5}
                    />
                )}

                {trendErr ? (
                    <Text className="text-muted-foreground text-xs">
                        Could not load that view.
                    </Text>
                ) : null}
            </CardContent>
        </Card>
    );
}

/** A top-5 preview with a link to the full list. */
function PreviewCard({
    title,
    dimension,
    entries,
    emptyLabel,
    href,
    roundArtwork,
}: {
    title: string;
    dimension: TopDimension;
    entries: EntityPlayCount[];
    emptyLabel: string;
    href: Href;
    roundArtwork?: boolean;
}) {
    return (
        <Card>
            <CardContent className="gap-4">
                <CardHeading title={title} href={href} />
                <TopEntityList
                    dimension={dimension}
                    entries={entries.slice(0, PREVIEW_COUNT)}
                    emptyLabel={emptyLabel}
                    roundArtwork={roundArtwork}
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

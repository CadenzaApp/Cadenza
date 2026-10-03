import { useState } from "react";
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";

import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import {
    useAnalyticsMetrics,
    useAnalyticsSummary,
    useAnalyticsTrend,
    type TrendBucketSize,
} from "@/lib/routes/analytics";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { cn } from "@/lib/utils";

import { BarChart, type Bar } from "./BarChart";
import {
    formatBucket,
    formatCount,
    formatDuration,
    formatHour,
    formatPercent,
} from "./format";
import { SongPlayList } from "./SongPlayList";
import { StatTile } from "./StatTile";

const BUCKETS: TrendBucketSize[] = ["day", "week", "month", "year"];

/**
 * What the user's listening looks like, from the event log.
 *
 * Reads `GET /analytics/summary` once and `GET /analytics/trends` per selected
 * metric and bucket. Every number here is computed in SQL by the backend; this
 * screen only formats and lays out.
 *
 * A new account is a real case and gets its own empty state rather than a page of
 * zeros, because a wall of zeros reads as broken.
 */
export function AnalyticsScreen() {
    const { contentBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll();
    const { summary, summaryLoading, summaryErr } = useAnalyticsSummary();
    const { metrics } = useAnalyticsMetrics();
    const [metric, setMetric] = useState("plays");
    const [bucket, setBucket] = useState<TrendBucketSize>("week");
    const { trend, trendLoading, trendErr } = useAnalyticsTrend(metric, bucket);

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
        // no plays means no events at all worth charting, whatever else is stored
        if ((stats.plays ?? 0) === 0) {
            return (
                <Message
                    title="Nothing to show yet"
                    detail="Play some music and your listening will show up here. A song counts once it has played for 15 seconds."
                />
            );
        }

        // labelled off the bucket the response was computed with, not the chip
        // that is selected. keepPreviousData holds the old series while a new
        // request is in flight or has failed, and labelling that as the new
        // bucket would relabel a weekly series as days
        const shownBucket = trend?.bucket ?? bucket;
        const trendBars: Bar[] =
            trend?.points.map((point) => ({
                label: formatBucket(point.bucket, shownBucket),
                value: point.value,
                readout: `${formatBucket(point.bucket, shownBucket)}: ${formatCount(point.value)}`,
            })) ?? [];

        const hourBars: Bar[] = summary.plays_by_hour.map((plays, hour) => ({
            label: formatHour(hour),
            value: plays,
            readout: `${formatHour(hour)}: ${formatCount(plays)} plays`,
        }));

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

                <Card>
                    <CardContent className="gap-4">
                        <View className="gap-1">
                            <CardTitle>
                                {trend?.description ?? "Over time"}
                            </CardTitle>
                            <Text className="text-muted-foreground text-xs">
                                Tap a bar for its value.
                            </Text>
                        </View>

                        <ChipRow
                            options={BUCKETS}
                            selected={bucket}
                            onSelect={setBucket}
                            labelOf={(value) => value}
                        />

                        {trendLoading && trendBars.length === 0 ? (
                            <Skeleton className="h-36 w-full" />
                        ) : (
                            <BarChart
                                bars={trendBars}
                                maxLabels={shownBucket === "day" ? 4 : 5}
                            />
                        )}

                        {trendErr ? (
                            <Text className="text-muted-foreground text-xs">
                                Could not load that view
                                {shownBucket !== bucket
                                    ? `, still showing ${shownBucket}s.`
                                    : "."}
                            </Text>
                        ) : null}

                        {metrics ? (
                            <ChipRow
                                options={metrics.map((m) => m.name)}
                                selected={metric}
                                onSelect={setMetric}
                                labelOf={(name) => name.replace(/_/g, " ")}
                            />
                        ) : null}
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="gap-4">
                        <CardTitle>When you listen</CardTitle>
                        <BarChart bars={hourBars} maxLabels={5} height={110} />
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="gap-4">
                        <CardTitle>Most played</CardTitle>
                        <SongPlayList
                            rows={summary.top_songs.map((song) => ({
                                songId: song.sample_song_id,
                                value: formatCount(song.plays),
                            }))}
                            emptyLabel="No plays in this window yet."
                        />
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="gap-4">
                        <View className="gap-1">
                            <CardTitle>On repeat</CardTitle>
                            <Text className="text-muted-foreground text-xs">
                                Most plays in one sitting.
                            </Text>
                        </View>
                        <SongPlayList
                            rows={summary.most_replayed.map((song) => ({
                                songId: song.song_id,
                                value: `${formatCount(song.most_in_one_session)}x`,
                            }))}
                            emptyLabel="Nothing played twice in a row yet."
                        />
                    </CardContent>
                </Card>

                {summary.top_tags.length > 0 ? (
                    <Card>
                        <CardContent className="gap-4">
                            <View className="gap-1">
                                <CardTitle>Tags you listen to</CardTitle>
                                <Text className="text-muted-foreground text-xs">
                                    Plays of songs carrying each tag.
                                </Text>
                            </View>
                            <View className="gap-3">
                                {summary.top_tags.map((tag) => (
                                    <View
                                        key={tag.name}
                                        className="flex-row items-center gap-3"
                                    >
                                        <View
                                            className="h-3 w-3 rounded-full"
                                            style={{
                                                backgroundColor: tag.color,
                                            }}
                                        />
                                        <Text
                                            className="flex-1 text-sm"
                                            numberOfLines={1}
                                        >
                                            {tag.name}
                                        </Text>
                                        <Text className="text-sm font-medium">
                                            {formatCount(tag.plays)}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        </CardContent>
                    </Card>
                ) : null}
            </>
        );
    };

    return (
        <ScreenScrollMarker>
            <Animated.ScrollView
                {...scroll}
                className="flex-1 bg-background"
                contentContainerClassName="gap-4 px-5 pt-5"
                contentContainerStyle={{ paddingBottom: contentBottomInset }}
                showsVerticalScrollIndicator={false}
            >
                {body()}
            </Animated.ScrollView>
        </ScreenScrollMarker>
    );
}

/** One row of selectable chips, which is how both pickers on this screen work. */
function ChipRow<T extends string>({
    options,
    selected,
    onSelect,
    labelOf,
}: {
    options: readonly T[];
    selected: T;
    onSelect: (value: T) => void;
    labelOf: (value: T) => string;
}) {
    return (
        <View className="flex-row flex-wrap gap-2">
            {options.map((option) => {
                const isSelected = option === selected;
                return (
                    <Pressable
                        key={option}
                        onPress={() => onSelect(option)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                        className={cn(
                            "border-border rounded-full border px-3 py-1",
                            isSelected && "bg-primary border-primary",
                        )}
                    >
                        <Text
                            className={cn(
                                "text-xs capitalize",
                                isSelected
                                    ? "text-primary-foreground"
                                    : "text-muted-foreground",
                            )}
                        >
                            {labelOf(option)}
                        </Text>
                    </Pressable>
                );
            })}
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

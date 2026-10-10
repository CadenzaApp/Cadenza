import { Pressable, View } from "react-native";

import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import type { AnalyticsWindow } from "@/lib/routes/analytics";
import { useListening } from "@/lib/routes/analytics-listening";

import { formatCount, formatDuration, formatPercent } from "./format";
import { shareOf, type TagFilter } from "./tag-share";

/** Fixed, so no level, filter or loading state moves the card. */
export const DETAIL_HEIGHT = 64;

/**
 * The shown span in two lines: its label, then time listened and plays. With
 * a tag filter the time is the tag's, with its share of all listening.
 *
 * The caller keys it by span, so a new span starts empty while a tag change
 * keeps the old numbers until the new ones land.
 */
export function HeatmapDetail({
    label,
    bucket,
    window,
    tag,
}: {
    label: string;
    bucket: string;
    window: AnalyticsWindow;
    tag: TagFilter;
}) {
    const { data, error, mutate } = useListening(
        bucket,
        window,
        tag?.id ?? null,
    );
    return (
        <View className="gap-1" style={{ height: DETAIL_HEIGHT }}>
            <Text className="text-muted-foreground text-sm" numberOfLines={1}>
                {label}
            </Text>
            {data ? (
                <View className="flex-row items-baseline gap-3">
                    <Text className="text-3xl font-semibold" numberOfLines={1}>
                        {formatDuration(data.listening_ms)}
                    </Text>
                    <Text
                        className="text-muted-foreground flex-1 text-sm"
                        numberOfLines={1}
                    >
                        {tag
                            ? `${formatPercent(shareOf(data.listening_ms, data.total_ms))} of listening`
                            : `${formatCount(data.plays)} ${data.plays === 1 ? "play" : "plays"}`}
                    </Text>
                </View>
            ) : error ? (
                <Pressable
                    className="min-h-11 justify-center"
                    onPress={() => void mutate()}
                    accessibilityRole="button"
                >
                    <Text className="text-muted-foreground text-sm">
                        Could not load. Tap to retry.
                    </Text>
                </Pressable>
            ) : (
                <Skeleton className="h-9 w-32 rounded-lg" />
            )}
        </View>
    );
}

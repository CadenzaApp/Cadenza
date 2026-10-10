import { useTheme } from "expo-router/react-navigation";
import { View } from "react-native";

import { Text } from "@/components/ui/text";
import {
    useAnalyticsSummary,
    type AnalyticsWindow,
} from "@/lib/routes/analytics";

import { formatCount, formatDuration, formatPercent } from "./format";
import { EMPTY_OPACITY } from "./HeatmapGrid";

/** How many tags the detail breaks a span down by. */
const DETAIL_TAGS = 2;
/** Fixed, so picking a span with fewer tags does not move the card. */
export const DETAIL_HEIGHT = 92;

/**
 * What one span of the heatmap was: how many listens, how long, and the tags
 * it was mostly, as a bar and a percent of listens each.
 */
export function HeatmapDetail({
    label,
    window,
}: {
    label: string;
    window: AnalyticsWindow;
}) {
    const { colors } = useTheme();
    const { summary } = useAnalyticsSummary(window);
    const plays = summary?.stats.plays ?? 0;
    const tags = (summary?.top_tags ?? []).slice(0, DETAIL_TAGS);
    // a song can carry both tags, so the shares can sum past the listens
    const total = Math.max(
        plays,
        tags.reduce((sum, tag) => sum + tag.plays, 0),
        1,
    );

    return (
        <View className="gap-2" style={{ height: DETAIL_HEIGHT }}>
            <View className="flex-row items-baseline justify-between gap-3">
                <Text className="flex-1 text-sm" numberOfLines={1}>
                    {label}
                </Text>
                <Text className="text-muted-foreground text-sm">
                    {summary
                        ? `${formatCount(plays)} ${plays === 1 ? "listen" : "listens"}`
                        : ""}
                </Text>
            </View>

            <View className="flex-row gap-4">
                <View className="w-2/5">
                    <Text className="text-3xl font-semibold" numberOfLines={1}>
                        {summary
                            ? formatDuration(summary.stats.listening_ms ?? 0)
                            : " "}
                    </Text>
                    <Text className="text-muted-foreground text-sm">
                        listened
                    </Text>
                </View>

                <View className="flex-1 gap-1.5 pt-1">
                    <View className="h-2.5 flex-row overflow-hidden rounded-full">
                        <View
                            className="absolute inset-0"
                            style={{
                                backgroundColor: String(colors.text),
                                opacity: EMPTY_OPACITY,
                            }}
                        />
                        {tags.map((tag) => (
                            <View
                                key={tag.id}
                                style={{
                                    width: `${(tag.plays / total) * 100}%`,
                                    backgroundColor: tag.color,
                                }}
                            />
                        ))}
                    </View>
                    {tags.length === 0 ? (
                        <Text className="text-muted-foreground text-xs">
                            {plays > 0 ? "Nothing tagged" : "Nothing played"}
                        </Text>
                    ) : null}
                    {tags.map((tag) => (
                        <View
                            key={tag.id}
                            className="flex-row items-center gap-2"
                        >
                            <View
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: tag.color }}
                            />
                            <Text className="flex-1 text-xs" numberOfLines={1}>
                                {tag.name}
                            </Text>
                            <Text className="text-muted-foreground text-xs">
                                {formatPercent(tag.plays / Math.max(plays, 1))}
                            </Text>
                        </View>
                    ))}
                </View>
            </View>
        </View>
    );
}

import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeInLeft, FadeInRight } from "react-native-reanimated";

import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useAnalyticsHeatmap } from "@/lib/routes/analytics";

import { AnalyticsCard } from "./AnalyticsCard";
import { useAnalyticsPeriod } from "./analytics-period";
import { HeatmapDetail } from "./HeatmapDetail";
import {
    EMPTY_OPACITY,
    HeatmapPages,
    LEVEL_OPACITY,
    UNTAGGED_COLOR,
    indexCells,
} from "./HeatmapGrid";
import {
    HEAT_LEVELS,
    initialPick,
    layoutHeatmap,
    type HeatmapPick,
} from "./heatmap-layout";
import {
    drillGrain,
    grainLabel,
    offsetOf,
    resolvePeriod,
    type ResolvedPeriod,
} from "./range";
import { TagCarousel } from "./TagCarousel";

/**
 * The grid box is this tall for its width, about a six week month calendar,
 * and never taller than `MAX_BOX`. Every level fills the same box, so opening
 * one never resizes the card.
 */
const BOX_ASPECT = 0.8;
const MAX_BOX = 340;
const BUTTON_HEIGHT = 44;
const DRILL_MS = 220;

/** One level of the drill: its period and the span picked in it, if any. */
type Level = { period: ResolvedPeriod; pick: HeatmapPick | null };

type Props = {
    /** The page's period, the top the card can go back up to. */
    root: ResolvedPeriod;
    accent: string | null;
};

/**
 * When the user listens, as squares laid out by the period: hours of a day,
 * two hour blocks of a week, days of a month, months of a year. All time is a
 * year a page, swiped sideways. Each square is colored by the tag played most
 * in it and brightened by how much played.
 *
 * A tap picks a square (a whole day in a week) and the detail under the grid
 * reads it out. The open button opens the pick one grain down, in place. The
 * card keeps its levels as a stack over `root`, so the back arrow walks back
 * up, never past `root`. The tags played across the level drift along the
 * bottom.
 */
export function Heatmap({ root, accent }: Props) {
    const { now } = useAnalyticsPeriod();
    const [levels, setLevels] = useState<Level[]>(() => [
        {
            period: root,
            pick: initialPick(layoutHeatmap(root.heatmap, now), now),
        },
    ]);
    const [back, setBack] = useState(false);
    const [width, setWidth] = useState(0);
    // when the last level change happened, so a double tap on open does not
    // open two levels
    const changedAt = useRef(0);

    const { period: scope, pick } = levels.at(-1)!;
    const window = { since: scope.since, until: scope.until };
    const child = drillGrain(scope.grain);
    const canOpen = child != null && pick != null && pick.start <= now;

    const { heatmap, heatmapLoading } = useAnalyticsHeatmap(
        scope.heatmapBucket,
        window,
    );
    const cells = useMemo(() => indexCells(heatmap), [heatmap]);
    const pages = layoutHeatmap(scope.heatmap, now, cells.earliestYear);

    const settling = () => sliding(changedAt.current);
    const choose = (next: HeatmapPick) =>
        setLevels((stack) => [
            ...stack.slice(0, -1),
            { ...stack.at(-1)!, pick: next },
        ]);
    const open = () => {
        if (!canOpen || settling()) return;
        const period = resolvePeriod(
            child,
            offsetOf(child, pick.start, now),
            now,
        );
        changedAt.current = clock();
        setBack(false);
        setLevels((stack) => [
            ...stack,
            {
                period,
                pick: initialPick(
                    layoutHeatmap(period.heatmap, now),
                    now,
                    pick,
                ),
            },
        ]);
    };
    const goBack = () => {
        if (settling()) return;
        changedAt.current = clock();
        setBack(true);
        setLevels((stack) => stack.slice(0, -1));
    };

    const box = Math.min(MAX_BOX, Math.round(width * BOX_ASPECT));
    const crumb = scope.grain === "all" ? "All time" : scope.dateLabel;

    return (
        <AnalyticsCard>
            <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1 flex-row items-center gap-2">
                    {levels.length > 1 ? (
                        <Pressable
                            onPress={goBack}
                            accessibilityRole="button"
                            accessibilityLabel={`Back to ${levels.at(-2)?.period.dateLabel}`}
                            hitSlop={10}
                        >
                            <BackChevron />
                        </Pressable>
                    ) : null}
                    <View className="flex-1 gap-1">
                        <Text role="heading" className="text-lg font-semibold">
                            When you listen
                        </Text>
                        <Breadcrumb parts={[crumb, pick?.short]} />
                    </View>
                </View>
                <Legend accent={accent} />
            </View>

            {/* keyed by level, so each one slides in fresh: from the right
                going down, the left coming back */}
            <View
                className="overflow-hidden"
                onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            >
                {width > 0 ? (
                    <Animated.View
                        key={`${scope.grain}:${scope.since ?? "all"}`}
                        entering={(back ? FadeInLeft : FadeInRight).duration(
                            DRILL_MS,
                        )}
                        className="gap-4"
                    >
                        <View style={{ height: box }}>
                            {heatmapLoading && !heatmap ? (
                                <Skeleton className="h-full w-full rounded-xl" />
                            ) : (
                                <HeatmapPages
                                    pages={pages}
                                    cells={cells}
                                    pick={pick}
                                    onPick={choose}
                                    width={width}
                                    height={box}
                                    ring={accent ?? UNTAGGED_COLOR}
                                />
                            )}
                        </View>

                        <Divider />

                        <HeatmapDetail
                            label={pick?.label ?? scope.dateLabel}
                            window={
                                pick
                                    ? {
                                          since: pick.start.toISOString(),
                                          until: pick.end.toISOString(),
                                      }
                                    : window
                            }
                        />

                        {/* the day has nothing under it, but keeps the room */}
                        <View style={{ height: BUTTON_HEIGHT }}>
                            {child ? (
                                <OpenButton
                                    label={`Open ${grainLabel(child).toLowerCase()}`}
                                    disabled={!canOpen}
                                    onPress={open}
                                />
                            ) : null}
                        </View>
                    </Animated.View>
                ) : null}
            </View>

            <Divider />
            <TagCarousel window={window} />
        </AnalyticsCard>
    );
}

/** Only ever read from a handler, never while rendering. */
function clock(): number {
    return Date.now();
}

/** Whether a level changed at `at` is still sliding in. */
function sliding(at: number): boolean {
    return clock() - at < DRILL_MS;
}

function Divider() {
    return <View className="bg-border h-px" />;
}

/** Where the card is, `2026 > October`, the last part left off when empty. */
function Breadcrumb({ parts }: { parts: (string | undefined)[] }) {
    const { colors } = useTheme();
    const shown = parts.filter(Boolean);
    return (
        <View className="flex-row items-center gap-1">
            {shown.map((part, index) => (
                <View key={index} className="flex-row items-center gap-1">
                    {index > 0 ? (
                        <Ionicons
                            name="chevron-forward"
                            size={11}
                            color={String(colors.text)}
                            style={{ opacity: 0.5 }}
                        />
                    ) : null}
                    <Text
                        className="text-muted-foreground text-xs"
                        numberOfLines={1}
                    >
                        {part}
                    </Text>
                </View>
            ))}
        </View>
    );
}

function OpenButton({
    label,
    disabled,
    onPress,
}: {
    label: string;
    disabled: boolean;
    onPress: () => void;
}) {
    const { colors } = useTheme();
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            className="border-border h-full flex-row items-center justify-center gap-1 rounded-full border"
            style={{ opacity: disabled ? 0.4 : 1 }}
        >
            <Text className="text-sm font-medium">{label}</Text>
            <Ionicons
                name="chevron-forward"
                size={14}
                color={String(colors.text)}
            />
        </Pressable>
    );
}

function BackChevron() {
    const { colors } = useTheme();
    return <Ionicons name="chevron-back" size={20} color={colors.text} />;
}

/** Less to more, in the page accent. */
function Legend({ accent }: { accent: string | null }) {
    const { colors } = useTheme();
    const color = accent ?? UNTAGGED_COLOR;
    const emptyColor = String(colors.text);
    return (
        <View className="flex-row items-center gap-1 pt-1.5">
            <Text className="text-muted-foreground mr-1 text-[10px]">Less</Text>
            {Array.from({ length: HEAT_LEVELS + 1 }, (_, level) => (
                <View
                    key={level}
                    style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        backgroundColor: level === 0 ? emptyColor : color,
                        opacity:
                            level === 0 ? EMPTY_OPACITY : LEVEL_OPACITY[level],
                    }}
                />
            ))}
            <Text className="text-muted-foreground ml-1 text-[10px]">More</Text>
        </View>
    );
}

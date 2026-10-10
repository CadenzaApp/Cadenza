import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, {
    FadeInLeft,
    FadeInRight,
    ReduceMotion,
} from "react-native-reanimated";

import { GlassButton } from "@/components/ui/glass-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import {
    useAnalyticsTagShares,
    type AnalyticsWindow,
    type TagListeningTime,
} from "@/lib/routes/analytics";
import { useListening } from "@/lib/routes/analytics-listening";

import { AnalyticsCard } from "./AnalyticsCard";
import { useAnalyticsPeriod } from "./analytics-period";
import { HeatmapDetail } from "./HeatmapDetail";
import {
    EMPTY_OPACITY,
    HeatmapGridView,
    LEVEL_OPACITY,
    UNTAGGED_COLOR,
    indexCells,
} from "./HeatmapGrid";
import {
    HEAT_LEVELS,
    layoutHeatmap,
    samePick,
    type HeatmapGrid,
    type HeatmapPick,
} from "./heatmap-layout";
import { ListeningSongs } from "./ListeningSongs";
import {
    drillGrain,
    grainLabel,
    offsetOf,
    resolvePeriod,
    type ResolvedPeriod,
} from "./range";
import { TagCarousel } from "./TagCarousel";
import type { TagFilter } from "./tag-share";

/**
 * The grid box is this tall for its width, about a six week month calendar,
 * and never taller than `MAX_BOX`. Every level fills the same box, so opening
 * one never resizes the card.
 */
const BOX_ASPECT = 0.8;
const MAX_BOX = 340;
const DRILL_MS = 220;
const DOUBLE_TAP_MS = 300;

/** One level of the drill: its period and the span picked in it, if any. */
type Level = { period: ResolvedPeriod; pick: HeatmapPick | null };

type Props = {
    /** The page's period, the top the card can go back up to. */
    root: ResolvedPeriod;
    accent: string | null;
    /** Lives above the card, so it survives a period change. */
    tagChoice: TagFilter;
    onTagChoice: (choice: TagFilter) => void;
};

/**
 * When the user listens, as squares laid out by the period, brightened by
 * listening time in the page accent.
 *
 * Nothing is picked at first, so the detail reads out the whole level. A tap
 * picks a square and a second tap lets go of it. A double tap, or the open
 * button, opens it one grain down, in place. The back arrow walks back up,
 * never past `root`. At a day the button opens the picked hour's songs.
 *
 * The tag carousel under the grid is the filter: tapping a tag pins it, and
 * the grid, legend and detail show only listening to songs with it, in the
 * tag's color.
 */
export function Heatmap({ root, accent, tagChoice, onTagChoice }: Props) {
    const { now } = useAnalyticsPeriod();
    const { colors } = useTheme();
    const [levels, setLevels] = useState<Level[]>([
        { period: root, pick: null },
    ]);
    const [back, setBack] = useState(false);
    const [width, setWidth] = useState(0);
    const [songsOpen, setSongsOpen] = useState(false);
    // when the last level change happened, so a double tap on open does not
    // open two levels
    const changedAt = useRef(0);
    // the last square tapped and when, so a second quick tap opens it
    const lastTap = useRef<{ pick: HeatmapPick; at: number } | null>(null);

    const { period: scope, pick } = levels.at(-1)!;
    const window = { since: scope.since, until: scope.until };
    const child = drillGrain(scope.grain);
    const tagId = tagChoice?.id ?? null;
    const ink = tagChoice?.color ?? accent ?? UNTAGGED_COLOR;

    const grid = layoutHeatmap(scope.heatmap);
    const shown = pick
        ? { since: pick.start.toISOString(), until: pick.end.toISOString() }
        : window;
    // the level's tags, unfiltered, so picking one never empties the row
    const { tagShares } = useAnalyticsTagShares(window);
    const tags = tagShares?.tags ?? [];

    // a picked span that has started, the only kind the button acts on
    const actionable = (target: HeatmapPick | null) =>
        target != null && target.start <= now;
    const opens = (target: HeatmapPick | null) =>
        child != null && actionable(target);
    const settling = () => sliding(changedAt.current);

    const open = (target: HeatmapPick | null) => {
        if (!child || !target || !opens(target) || settling()) return;
        const period = resolvePeriod(
            child,
            offsetOf(child, target.start, now),
            now,
        );
        changedAt.current = clock();
        lastTap.current = null;
        setBack(false);
        setLevels((stack) => [...stack, { period, pick: null }]);
    };
    // one tap picks a square or lets go of it, a second quick one opens it
    const tap = (target: HeatmapPick) => {
        if (target.start > now || settling()) return;
        const at = clock();
        const last = lastTap.current;
        if (
            last &&
            samePick(last.pick, target) &&
            at - last.at < DOUBLE_TAP_MS &&
            opens(target)
        ) {
            open(target);
            return;
        }
        lastTap.current = { pick: target, at };
        setLevels((stack) => {
            const top = stack.at(-1)!;
            const same = top.pick != null && samePick(top.pick, target);
            return [
                ...stack.slice(0, -1),
                { ...top, pick: same ? null : target },
            ];
        });
    };
    const goBack = () => {
        if (settling()) return;
        changedAt.current = clock();
        lastTap.current = null;
        setBack(true);
        setLevels((stack) => stack.slice(0, -1));
    };
    const pinTag = (id: number) => {
        const tag = tags.find((each) => each.id === id);
        if (tag)
            onTagChoice({
                id: tag.id,
                name: tag.name,
                color: tag.color,
                type: tag.type,
            });
    };
    // a pinned tag this level lacks still shows, at zero
    const pinned: TagListeningTime | null = tagChoice
        ? (tags.find((each) => each.id === tagChoice.id) ?? {
              ...tagChoice,
              listening_ms: 0,
          })
        : null;

    const box = Math.min(MAX_BOX, Math.round(width * BOX_ASPECT));
    const buttonDisabled = !actionable(pick);

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
                            <Ionicons
                                name="chevron-back"
                                size={20}
                                color={colors.text}
                            />
                        </Pressable>
                    ) : null}
                    <View className="flex-1 gap-1">
                        <Text role="heading" className="text-lg font-semibold">
                            When you listen
                        </Text>
                        <Text
                            className="text-muted-foreground text-xs"
                            numberOfLines={1}
                        >
                            {scope.dateLabel}
                            {pick ? ` > ${pick.short}` : ""}
                        </Text>
                    </View>
                </View>
                <Legend color={ink} />
            </View>

            {/* keyed by level, so each one slides in fresh: from the right
                going down, the left coming back */}
            <View
                className="overflow-hidden"
                onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            >
                {width > 0 ? (
                    <Animated.View
                        key={`${scope.grain}:${scope.since}`}
                        entering={(back ? FadeInLeft : FadeInRight)
                            .duration(DRILL_MS)
                            .reduceMotion(ReduceMotion.System)}
                        style={{ height: box }}
                    >
                        <LevelGrid
                            bucket={scope.heatmapBucket}
                            window={window}
                            tagId={tagId}
                            grid={grid}
                            pick={pick}
                            onPick={tap}
                            width={width}
                            height={box}
                            ring={ink}
                            now={now}
                        />
                    </Animated.View>
                ) : null}
            </View>

            <TagCarousel
                tags={tags}
                totalMs={tagShares?.total_ms ?? 0}
                loaded={!!tagShares}
                selected={pinned}
                onSelect={pinTag}
                onRelease={() => onTagChoice(null)}
            />
            <View className="h-px bg-border" />
            {/* keyed by span, so it keeps its numbers only across a tag change */}
            <HeatmapDetail
                key={`${shown.since}:${shown.until}`}
                label={pick?.label ?? scope.dateLabel}
                bucket={scope.heatmapBucket}
                window={shown}
                tag={tagChoice}
            />

            {/* outside the sliding level: glass mounted mid fade stays flat
                until something redraws it */}
            <GlassButton
                className="h-11 rounded-full"
                disabled={buttonDisabled}
                accessibilityState={{ disabled: buttonDisabled }}
                onPress={() => (child ? open(pick) : setSongsOpen(true))}
            >
                <Text className="text-sm font-medium">
                    {child
                        ? `Open ${grainLabel(child).toLowerCase()}`
                        : "View hour"}
                </Text>
                <Ionicons
                    name="chevron-forward"
                    size={14}
                    color={colors.text}
                />
            </GlassButton>

            {songsOpen && pick ? (
                <ListeningSongs
                    window={shown}
                    tagId={tagId}
                    title={pick.label}
                    onClose={() => setSongsOpen(false)}
                />
            ) : null}
        </AnalyticsCard>
    );
}

/**
 * One level's grid and its read. It lives inside the level's keyed slide, so
 * a new period mounts a fresh read, while a tag change keeps the old cells on
 * screen until the filtered ones land.
 */
function LevelGrid({
    bucket,
    window,
    tagId,
    grid,
    pick,
    onPick,
    width,
    height,
    ring,
    now,
}: {
    bucket: string;
    window: AnalyticsWindow;
    tagId: number | null;
    grid: HeatmapGrid;
    pick: HeatmapPick | null;
    onPick: (pick: HeatmapPick) => void;
    width: number;
    height: number;
    ring: string;
    now: Date;
}) {
    const { data, error, mutate } = useListening(bucket, window, tagId);
    const cells = useMemo(() => indexCells(data), [data]);
    if (data) {
        return (
            <HeatmapGridView
                grid={grid}
                cells={cells}
                pick={pick}
                onPick={onPick}
                width={width}
                height={height}
                ring={ring}
                now={now}
            />
        );
    }
    return error ? (
        <Pressable
            className="flex-1 items-center justify-center"
            accessibilityRole="button"
            onPress={() => void mutate()}
        >
            <Text className="text-muted-foreground text-sm">
                Could not load. Tap to retry.
            </Text>
        </Pressable>
    ) : (
        <Skeleton className="h-full w-full rounded-xl" />
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

/** Less to more, in the page accent. */
function Legend({ color }: { color: string }) {
    const { colors } = useTheme();
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

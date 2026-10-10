import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeInLeft, FadeInRight } from "react-native-reanimated";

import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import {
    useAnalyticsHeatmap,
    type AnalyticsHeatmap,
    type HeatmapTag,
} from "@/lib/routes/analytics";

import { AnalyticsCard } from "./AnalyticsCard";
import { useAnalyticsPeriod } from "./analytics-period";
import { formatCount } from "./format";
import {
    HEAT_LEVELS,
    heatLevel,
    layoutHeatmap,
    type LayoutCell,
} from "./heatmap-layout";
import {
    drillGrain,
    offsetOf,
    resolvePeriod,
    type PeriodGrain,
    type ResolvedPeriod,
} from "./range";
import { SectionHeading } from "./SectionHeading";

/** Plays that carried none of the user's tags. */
const UNTAGGED_COLOR = "#a3a3a3";
/** Opacity per heat level. Index 0 is never drawn with a color. */
const LEVEL_OPACITY = [0, 0.35, 0.55, 0.78, 1];
/** An empty square is the text color this faint, so it reads on any tint. */
const EMPTY_OPACITY = 0.1;
const GAP = 2;
const ROW_LABEL_WIDTH = 30;
/** Big enough that a month calendar fills the card. */
const MAX_CELL = 48;
const MAX_RADIUS = 8;
/** A column label is centered over its column in a box this wide. */
const COL_LABEL_WIDTH = 48;
/** Below this a grid scrolls sideways rather than shrinking further. */
const MIN_CELL = 8;
/** How many tags the key under the grid names. */
const KEY_TAGS = 4;
const DRILL_MS = 220;

type Props = {
    /** The page's period, the top the card can go back up to. */
    root: ResolvedPeriod;
    accent: string | null;
};

/**
 * When the user listens, as a grid of squares laid out by the period: hours of
 * a day or week, days of a month, months of a year or of every year. Each square is
 * colored by the tag played most in it and brightened by how much played.
 *
 * Tapping a square opens it in place, one grain down: a year's month, a month's
 * week, a week's day. The card keeps the levels it opened as a stack over
 * `root`, so its back arrow walks back up, never past `root`. At a day, the
 * bottom, a tap reads out the square's numbers; above it a long press does.
 */
export function Heatmap({ root, accent }: Props) {
    const { now } = useAnalyticsPeriod();
    const [opened, setOpened] = useState<ResolvedPeriod[]>([]);
    const [back, setBack] = useState(false);

    const scope = opened.at(-1) ?? root;
    const parent = opened.length > 1 ? opened.at(-2) : root;

    const { heatmap, heatmapLoading } = useAnalyticsHeatmap(
        scope.heatmapBucket,
        { since: scope.since, until: scope.until },
    );
    // the previous level's data is kept while this one loads, and it is cut
    // in another bucket, so it would paint the wrong squares
    const current =
        heatmap?.bucket === scope.heatmapBucket ? heatmap : undefined;

    const open = (date: Date) => {
        const grain = drillGrain(scope.grain);
        if (!grain) return;
        const offset = offsetOf(grain, date, now);
        // nothing has played in the future
        if (offset > 0) return;
        setBack(false);
        setOpened((stack) => [...stack, resolvePeriod(grain, offset, now)]);
    };
    const goBack = () => {
        setBack(true);
        setOpened((stack) => stack.slice(0, -1));
    };

    return (
        <AnalyticsCard>
            <View className="flex-row items-center justify-between gap-3">
                {opened.length > 0 ? (
                    <Pressable
                        onPress={goBack}
                        accessibilityRole="button"
                        accessibilityLabel={`Back to ${parent?.dateLabel}`}
                        hitSlop={10}
                    >
                        <BackChevron />
                    </Pressable>
                ) : null}
                <View className="flex-1">
                    <SectionHeading
                        title="When you listen"
                        detail={opened.length > 0 ? scope.dateLabel : undefined}
                    />
                </View>
                <Legend accent={accent} />
            </View>

            {/* keyed by level, so each one slides in fresh with nothing
                selected: from the right going down, the left coming back */}
            <Animated.View
                key={levelKey(scope)}
                entering={(back ? FadeInLeft : FadeInRight).duration(DRILL_MS)}
                className="gap-4"
            >
                <HeatmapLevel
                    scope={scope}
                    heatmap={current}
                    loading={heatmapLoading || (heatmap != null && !current)}
                    now={now}
                    onOpen={drillGrain(scope.grain) ? open : null}
                />
            </Animated.View>
        </AnalyticsCard>
    );
}

/** One level of the drill: the grid, the readout under it, and the tag key. */
function HeatmapLevel({
    scope,
    heatmap,
    loading,
    now,
    onOpen,
}: {
    scope: ResolvedPeriod;
    heatmap?: AnalyticsHeatmap;
    loading: boolean;
    now: Date;
    /** Opens a square's date one grain down. Null at the bottom. */
    onOpen: ((date: Date) => void) | null;
}) {
    const { colors } = useTheme();
    const [width, setWidth] = useState(0);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);

    const { byKey, tagsById, maxPlays, earliestYear } = useMemo(
        () => indexCells(heatmap),
        [heatmap],
    );
    const grid = useMemo(
        () => layoutHeatmap(scope.heatmap, now, earliestYear),
        [earliestYear, now, scope.heatmap],
    );

    const columns = Math.max(...grid.rows.map((row) => row.length), 1);
    const hasRowLabels = grid.rowLabels.some(Boolean);
    const labelWidth = hasRowLabels ? ROW_LABEL_WIDTH : 0;
    // fractional, so the grid runs to the card's edge rather than leaving
    // a pixel per column of slack on the right
    const fitted = (width - labelWidth - GAP * (columns - 1)) / columns;
    const cell = Math.max(MIN_CELL, Math.min(MAX_CELL, fitted));
    const scrolls = fitted < MIN_CELL;

    const selected = selectedKey ? findCell(grid.rows, selectedKey) : null;
    const selectedData = selectedKey ? byKey.get(selectedKey) : undefined;
    const keyTags = heatmap?.tags.slice(0, KEY_TAGS) ?? [];

    const body = (
        <View>
            {grid.rows.map((row, rowIndex) => (
                <View
                    key={rowIndex}
                    className="flex-row items-center"
                    style={{ marginBottom: GAP }}
                >
                    {hasRowLabels ? (
                        <Text
                            className="text-muted-foreground text-[10px]"
                            style={{ width: labelWidth }}
                        >
                            {grid.rowLabels[rowIndex] ?? ""}
                        </Text>
                    ) : null}
                    {row.map((slot, colIndex) => (
                        <Square
                            key={slot?.key ?? `spacer-${colIndex}`}
                            slot={slot}
                            size={cell}
                            marginLeft={colIndex === 0 ? 0 : GAP}
                            plays={slot ? (byKey.get(slot.key)?.plays ?? 0) : 0}
                            color={squareColor(
                                slot ? byKey.get(slot.key)?.tag_id : null,
                                tagsById,
                            )}
                            maxPlays={maxPlays}
                            selected={slot?.key === selectedKey}
                            textColor={String(colors.text)}
                            onPress={
                                onOpen && slot
                                    ? () => onOpen(slot.date)
                                    : () => slot && setSelectedKey(slot.key)
                            }
                            onLongPress={
                                slot
                                    ? () => setSelectedKey(slot.key)
                                    : undefined
                            }
                            opens={onOpen != null}
                        />
                    ))}
                </View>
            ))}
            <View style={{ height: 14, marginLeft: labelWidth }}>
                {grid.colLabels.map((label, index) =>
                    label ? (
                        <Text
                            key={index}
                            className="text-muted-foreground absolute text-center text-[10px]"
                            style={{
                                left:
                                    index * (cell + GAP) +
                                    cell / 2 -
                                    COL_LABEL_WIDTH / 2,
                                width: COL_LABEL_WIDTH,
                            }}
                            numberOfLines={1}
                        >
                            {label}
                        </Text>
                    ) : null,
                )}
            </View>
        </View>
    );

    return (
        <>
            <View
                onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            >
                {loading && !heatmap ? (
                    <Skeleton className="h-40 w-full rounded-xl" />
                ) : width === 0 ? null : scrolls ? (
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                    >
                        {body}
                    </ScrollView>
                ) : (
                    body
                )}
            </View>

            <Text className="text-muted-foreground text-xs">
                {selected
                    ? [
                          selected.label,
                          `${formatCount(selectedData?.plays ?? 0)} plays`,
                          selectedData?.tag_id != null
                              ? tagsById.get(selectedData.tag_id)?.name
                              : null,
                      ]
                          .filter(Boolean)
                          .join(" - ")
                    : `Colored by the tag you played most. ${hintFor(scope.grain)}`}
            </Text>

            {keyTags.length > 0 ? (
                <View className="flex-row flex-wrap gap-x-4 gap-y-2">
                    {keyTags.map((tag) => (
                        <View
                            key={tag.id}
                            className="flex-row items-center gap-1.5"
                        >
                            <View
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: tag.color }}
                            />
                            <Text className="text-xs">{tag.name}</Text>
                        </View>
                    ))}
                </View>
            ) : null}
        </>
    );
}

/** What a tap does at a level, for the line under the grid. */
function hintFor(grain: PeriodGrain): string {
    switch (grain) {
        case "all":
        case "year":
            return "Tap a month to open it.";
        case "month":
            return "Tap a day to open its week.";
        case "week":
            return "Tap a square to open its day.";
        case "day":
            return "Tap a square.";
    }
}

/** Identifies a level, for keying its view. */
function levelKey(scope: ResolvedPeriod): string {
    return `${scope.grain}:${scope.since ?? "all"}`;
}

function BackChevron() {
    const { colors } = useTheme();
    return <Ionicons name="chevron-back" size={20} color={colors.text} />;
}

function Square({
    slot,
    size,
    marginLeft,
    plays,
    color,
    maxPlays,
    selected,
    textColor,
    onPress,
    onLongPress,
    opens,
}: {
    slot: LayoutCell | null;
    size: number;
    marginLeft: number;
    plays: number;
    color: string;
    maxPlays: number;
    selected: boolean;
    /** Fills an empty square, faintly, and rings a selected one. */
    textColor: string;
    onPress: () => void;
    onLongPress?: () => void;
    /** Whether a tap opens the square rather than reading it out. */
    opens: boolean;
}) {
    const radius = Math.min(MAX_RADIUS, Math.max(2, size * 0.22));
    if (!slot) {
        return <View style={{ width: size, height: size, marginLeft }} />;
    }

    const level = heatLevel(plays, maxPlays);
    return (
        <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            accessibilityRole="button"
            accessibilityLabel={`${slot.label}, ${plays} plays`}
            accessibilityHint={opens ? "Opens it" : undefined}
            style={{
                width: size,
                height: size,
                marginLeft,
                borderRadius: radius,
                overflow: "hidden",
                borderWidth: selected ? 1.5 : 0,
                borderColor: textColor,
            }}
        >
            {/* the fill is its own layer, so its opacity does not fade the
                selection ring with it */}
            <View
                style={[
                    StyleSheet.absoluteFill,
                    {
                        backgroundColor: level === 0 ? textColor : color,
                        opacity:
                            level === 0 ? EMPTY_OPACITY : LEVEL_OPACITY[level],
                    },
                ]}
            />
        </Pressable>
    );
}

/** Less to more, in the page accent. */
function Legend({ accent }: { accent: string | null }) {
    const { colors } = useTheme();
    const color = accent ?? UNTAGGED_COLOR;
    const emptyColor = String(colors.text);
    return (
        <View className="flex-row items-center gap-1">
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

function squareColor(
    tagId: number | null | undefined,
    tagsById: Map<number, HeatmapTag>,
): string {
    return (
        (tagId != null ? tagsById.get(tagId)?.color : null) ?? UNTAGGED_COLOR
    );
}

function findCell(
    rows: (LayoutCell | null)[][],
    key: string,
): LayoutCell | null {
    for (const row of rows) {
        for (const slot of row) if (slot?.key === key) return slot;
    }
    return null;
}

/** The sparse cells by key, the tags by id, the peak, and the first year. */
function indexCells(heatmap?: AnalyticsHeatmap) {
    const byKey = new Map<string, AnalyticsHeatmap["cells"][number]>();
    const tagsById = new Map<number, HeatmapTag>();
    let maxPlays = 0;
    let earliestYear: number | undefined;

    for (const tag of heatmap?.tags ?? []) tagsById.set(tag.id, tag);
    for (const cell of heatmap?.cells ?? []) {
        byKey.set(cell.start, cell);
        maxPlays = Math.max(maxPlays, cell.plays);
        const year = Number(cell.start.slice(0, 4));
        if (Number.isFinite(year)) {
            earliestYear = Math.min(earliestYear ?? year, year);
        }
    }
    return { byKey, tagsById, maxPlays, earliestYear };
}

import { useTheme } from "expo-router/react-navigation";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import type {
    Listening,
    ListeningCell,
} from "@/lib/routes/analytics-listening";

import { formatDuration } from "./format";
import {
    heatLevel,
    samePick,
    type HeatmapGrid as Grid,
    type HeatmapPick,
    type LayoutCell,
} from "./heatmap-layout";

export const UNTAGGED_COLOR = "#a3a3a3";
export const LEVEL_OPACITY = [0, 0.35, 0.55, 0.78, 1];
export const EMPTY_OPACITY = 0.1;
const GAP = 4;
const LABEL_WIDTH = 24;
const CAPTION_HEIGHT = 18;

export type CellIndex = { byKey: Map<string, ListeningCell>; maxMs: number };

export function indexCells(listening?: Listening): CellIndex {
    const byKey = new Map(
        (listening?.cells ?? []).map((cell) => [cell.start, cell]),
    );
    const maxMs = Math.max(
        0,
        ...(listening?.cells ?? []).map((cell) => cell.listening_ms),
    );
    return { byKey, maxMs };
}

type GridProps = {
    grid: Grid;
    cells: CellIndex;
    pick: HeatmapPick | null;
    onPick: (pick: HeatmapPick) => void;
    width: number;
    height: number;
    ring: string;
    now: Date;
};

/** Every level fits the same box. Only the week draws bars; squares show their level by brightness. */
export function HeatmapGridView(props: GridProps) {
    return (
        <View style={{ width: props.width, height: props.height }}>
            {props.grid.columns ? (
                <WeekBars {...props} />
            ) : (
                <RowGrid {...props} />
            )}
        </View>
    );
}

function RowGrid({
    grid,
    cells,
    pick,
    onPick,
    width,
    height,
    ring,
    now,
}: GridProps) {
    const columns = Math.max(...grid.lines.map((row) => row.length), 1);
    const labelWidth = grid.rowLabels ? LABEL_WIDTH : 0;
    const headerHeight = grid.header ? 22 : 0;
    const captionRows = grid.lines.filter((row) =>
        row.some((cell) => cell?.caption),
    ).length;
    const fitW = (width - labelWidth - GAP * (columns - 1)) / columns;
    const fitH =
        (height -
            headerHeight -
            captionRows * CAPTION_HEIGHT -
            GAP * (grid.lines.length - 1)) /
        grid.lines.length;
    const cellW = grid.square ? Math.min(fitW, fitH) : fitW;
    const cellH = grid.square ? cellW : fitH;

    return (
        <View className="flex-1 items-center justify-center">
            {grid.header ? (
                <View
                    className="flex-row"
                    style={{ height: headerHeight, marginLeft: labelWidth }}
                >
                    {grid.header.map((label, i) => (
                        <Text
                            key={i}
                            className="text-muted-foreground text-center text-[10px]"
                            style={{
                                width: cellW,
                                marginLeft: i === 0 ? 0 : GAP,
                            }}
                        >
                            {label}
                        </Text>
                    ))}
                </View>
            ) : null}
            {grid.lines.map((row, rowIndex) => (
                <View
                    key={rowIndex}
                    style={{ marginTop: rowIndex === 0 ? 0 : GAP }}
                >
                    <View className="flex-row items-center">
                        {grid.rowLabels ? (
                            <Text
                                className="text-muted-foreground text-[10px]"
                                style={{ width: labelWidth }}
                            >
                                {grid.rowLabels[rowIndex]}
                            </Text>
                        ) : null}
                        {row.map((cell, i) => (
                            <Square
                                key={cell?.key ?? i}
                                cell={cell}
                                data={
                                    cell ? cells.byKey.get(cell.key) : undefined
                                }
                                maxMs={cells.maxMs}
                                width={cellW}
                                height={cellH}
                                marginLeft={i === 0 ? 0 : GAP}
                                picked={
                                    !!(
                                        cell?.pick &&
                                        pick &&
                                        samePick(cell.pick, pick)
                                    )
                                }
                                accent={ring}
                                future={!!cell?.pick && cell.pick.start > now}
                                onPick={onPick}
                            />
                        ))}
                    </View>
                    {row.some((cell) => cell?.caption) ? (
                        <View
                            className="flex-row"
                            style={{
                                height: CAPTION_HEIGHT,
                                marginLeft: labelWidth,
                            }}
                        >
                            {row.map((cell, i) => (
                                <Text
                                    key={cell?.key ?? i}
                                    className="text-muted-foreground text-center text-[9px]"
                                    style={{
                                        width: cellW,
                                        marginLeft: i === 0 ? 0 : GAP,
                                    }}
                                    numberOfLines={1}
                                >
                                    {cell?.caption ?? ""}
                                </Text>
                            ))}
                        </View>
                    ) : null}
                </View>
            ))}
        </View>
    );
}

/** One additive duration per day, with explicit values and a visible scale. */
function WeekBars({ grid, cells, pick, onPick, ring, now }: GridProps) {
    const { colors } = useTheme();
    return (
        <View className="flex-1 gap-2">
            <Text className="text-muted-foreground text-right text-[10px]">
                Peak {formatDuration(cells.maxMs)}
            </Text>
            <View className="flex-1 flex-row gap-1">
                {grid.lines.map((column, i) => {
                    const cell = column[0];
                    const target = cell?.pick;
                    const data = cell ? cells.byKey.get(cell.key) : undefined;
                    const ms = data?.listening_ms ?? 0;
                    const picked = !!(target && pick && samePick(target, pick));
                    const future = !!target && target.start > now;
                    const fraction =
                        cells.maxMs > 0
                            ? Math.min(1, Math.max(0, ms / cells.maxMs))
                            : 0;
                    return (
                        <Pressable
                            key={cell?.key ?? i}
                            className="flex-1 gap-2 rounded-xl p-1 active:opacity-60"
                            style={{
                                borderWidth: 1.5,
                                borderColor: picked ? ring : "transparent",
                                opacity: future ? 0.35 : 1,
                            }}
                            disabled={!target || future}
                            onPress={() => target && onPick(target)}
                            accessibilityRole="button"
                            accessibilityLabel={`${target?.label}, ${formatDuration(ms)} listened, ${data?.plays ?? 0} plays`}
                            accessibilityState={{
                                selected: picked,
                                disabled: !target || future,
                            }}
                        >
                            <Text
                                className="text-center text-xs"
                                numberOfLines={2}
                            >
                                {grid.header?.[i]}
                            </Text>
                            <View className="flex-1 justify-end overflow-hidden rounded-md">
                                <View
                                    className="absolute inset-0 rounded-md"
                                    style={{
                                        backgroundColor: colors.text,
                                        opacity: EMPTY_OPACITY,
                                    }}
                                />
                                <View
                                    className="w-full rounded-md"
                                    style={{
                                        height: `${fraction * 100}%`,
                                        backgroundColor: ring,
                                    }}
                                />
                            </View>
                            <Text
                                className="text-muted-foreground text-center text-[10px]"
                                numberOfLines={1}
                            >
                                {future ? "-" : formatDuration(ms)}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

function Square({
    cell,
    data,
    maxMs,
    width,
    height,
    marginLeft,
    picked,
    accent,
    future,
    onPick,
}: {
    cell: LayoutCell | null;
    data?: ListeningCell;
    maxMs: number;
    width: number;
    height: number;
    marginLeft: number;
    picked: boolean;
    accent: string;
    future: boolean;
    onPick: (pick: HeatmapPick) => void;
}) {
    const { colors } = useTheme();
    if (!cell) return <View style={{ width, height, marginLeft }} />;
    const ms = data?.listening_ms ?? 0;
    const level = heatLevel(ms, maxMs);
    const disabled = !cell.pick || future;
    return (
        <Pressable
            className="items-center justify-center overflow-hidden rounded-lg active:opacity-60"
            style={{
                width,
                height,
                marginLeft,
                borderWidth: 1.5,
                borderColor: picked ? accent : "transparent",
                opacity: disabled ? 0.35 : 1,
            }}
            disabled={disabled}
            onPress={() => cell.pick && onPick(cell.pick)}
            accessibilityRole="button"
            accessibilityLabel={`${cell.pick?.label ?? cell.text}, ${formatDuration(ms)} listened, ${data?.plays ?? 0} plays`}
            accessibilityState={{ selected: picked, disabled }}
        >
            {/* brightness alone carries the level: a bar inside a cell this
                small does not read */}
            <View
                className="absolute inset-0"
                style={{
                    backgroundColor: level ? accent : colors.text,
                    opacity: level ? LEVEL_OPACITY[level] : EMPTY_OPACITY,
                }}
            />
            {cell.text ? (
                <Text
                    className="text-center text-xs font-medium"
                    numberOfLines={1}
                >
                    {cell.text}
                </Text>
            ) : null}
        </Pressable>
    );
}

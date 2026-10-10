import { useTheme } from "expo-router/react-navigation";
import { Pressable, Text as RNText, StyleSheet, View } from "react-native";

import { Text } from "@/components/ui/text";
import type { AnalyticsHeatmap, HeatmapTag } from "@/lib/routes/analytics";

import {
    heatLevel,
    samePick,
    type HeatmapGrid as Grid,
    type HeatmapPick,
    type LayoutCell,
} from "./heatmap-layout";

/** What is printed inside a square: a month's name, a day's date. */
const CELL_TEXT_COLOR = "#d4d4d4";
/** Plays that carried none of the user's tags. */
export const UNTAGGED_COLOR = "#a3a3a3";
/** Opacity per heat level. Index 0 is never drawn with a color. */
export const LEVEL_OPACITY = [0, 0.35, 0.55, 0.78, 1];
/** An empty square is the text color this faint, so it reads on any tint. */
export const EMPTY_OPACITY = 0.1;
const GAP = 4;
/** Between the blocks of a week's column, tighter than between columns. */
const BLOCK_GAP = 2;
/** Room inside a week's column for its selection ring. */
const COLUMN_PAD = 3;
const ROW_LABEL_WIDTH = 28;
const LINE_HEIGHT = 14;
const CAPTION_HEIGHT = 16;
const MAX_RADIUS = 10;
const RING_WIDTH = 1.5;

/** The sparse cells by key, the tags by id, and the peak. */
export type CellIndex = {
    byKey: Map<string, AnalyticsHeatmap["cells"][number]>;
    tagsById: Map<number, HeatmapTag>;
    maxPlays: number;
};

export function indexCells(heatmap?: AnalyticsHeatmap): CellIndex {
    const index: CellIndex = {
        byKey: new Map(),
        tagsById: new Map(),
        maxPlays: 0,
    };
    for (const tag of heatmap?.tags ?? []) index.tagsById.set(tag.id, tag);
    for (const cell of heatmap?.cells ?? []) {
        index.byKey.set(cell.start, cell);
        index.maxPlays = Math.max(index.maxPlays, cell.plays);
    }
    return index;
}

type GridProps = {
    grid: Grid;
    cells: CellIndex;
    pick: HeatmapPick | null;
    onPick: (pick: HeatmapPick) => void;
    width: number;
    height: number;
    /** Rings the picked square or column. */
    ring: string;
};

/** A level's squares in a fixed box: rows of squares, or a week's columns. */
export function HeatmapGridView(props: GridProps) {
    return (
        <View style={{ width: props.width, height: props.height }}>
            {props.grid.columns ? (
                <ColumnGrid {...props} />
            ) : (
                <RowGrid {...props} />
            )}
        </View>
    );
}

/** Rows of squares, each picked on its own. */
function RowGrid({
    grid,
    cells,
    pick,
    onPick,
    width,
    height,
    ring,
}: GridProps) {
    const { colors } = useTheme();
    const rows = grid.lines;
    const columns = Math.max(...rows.map((row) => row.length), 1);
    const labelWidth = grid.rowLabels ? ROW_LABEL_WIDTH : 0;
    const header = grid.header ? headerHeight(grid.header) + GAP : 0;
    const captions =
        rows.filter((row) => row.some((cell) => cell?.caption)).length *
        CAPTION_HEIGHT;

    // fractional, so the grid runs to the box's edges
    const fitW = (width - labelWidth - GAP * (columns - 1)) / columns;
    const fitH =
        (height - header - captions - GAP * (rows.length - 1)) / rows.length;
    const cellW = grid.square ? Math.min(fitW, fitH) : fitW;
    const cellH = grid.square ? cellW : fitH;

    return (
        <View className="flex-1 items-center justify-center">
            {grid.header ? (
                <View
                    className="flex-row"
                    style={{ marginLeft: labelWidth, marginBottom: GAP }}
                >
                    {grid.header.map((label, index) => (
                        <Label
                            key={index}
                            text={label}
                            width={cellW}
                            marginLeft={index === 0 ? 0 : GAP}
                        />
                    ))}
                </View>
            ) : null}
            {rows.map((row, rowIndex) => (
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
                        {row.map((cell, index) => (
                            <Square
                                key={cell?.key ?? `spacer-${index}`}
                                cell={cell}
                                cells={cells}
                                width={cellW}
                                height={cellH}
                                marginLeft={index === 0 ? 0 : GAP}
                                empty={String(colors.text)}
                                ring={
                                    cell?.pick &&
                                    pick &&
                                    samePick(cell.pick, pick)
                                        ? ring
                                        : null
                                }
                                onPress={
                                    cell?.pick
                                        ? () => onPick(cell.pick!)
                                        : undefined
                                }
                            />
                        ))}
                    </View>
                    {row.some((cell) => cell?.caption) ? (
                        <View
                            className="flex-row"
                            style={{
                                marginLeft: labelWidth,
                                height: CAPTION_HEIGHT,
                            }}
                        >
                            {row.map((cell, index) => (
                                <Label
                                    key={index}
                                    text={cell?.caption ?? ""}
                                    width={cellW}
                                    marginLeft={index === 0 ? 0 : GAP}
                                />
                            ))}
                        </View>
                    ) : null}
                </View>
            ))}
        </View>
    );
}

/** Columns of blocks under a header, each column picked as a whole. */
function ColumnGrid({
    grid,
    cells,
    pick,
    onPick,
    width,
    height,
    ring,
}: GridProps) {
    const { colors } = useTheme();
    const columns = grid.lines;
    const blocks = Math.max(...columns.map((column) => column.length), 1);
    const header = grid.header ? headerHeight(grid.header) + GAP : 0;

    const columnW = (width - GAP * (columns.length - 1)) / columns.length;
    const blockW = columnW - COLUMN_PAD * 2;
    const blockH =
        (height - header - COLUMN_PAD * 2 - BLOCK_GAP * (blocks - 1)) / blocks;

    return (
        <View className="flex-1 flex-row">
            {columns.map((column, index) => {
                const columnPick = column.find((cell) => cell?.pick)?.pick;
                const picked =
                    columnPick != null &&
                    pick != null &&
                    samePick(columnPick, pick);
                return (
                    <Pressable
                        key={index}
                        onPress={
                            columnPick ? () => onPick(columnPick) : undefined
                        }
                        accessibilityRole="button"
                        accessibilityLabel={columnPick?.label}
                        accessibilityState={{ selected: picked }}
                        style={{
                            width: columnW,
                            marginLeft: index === 0 ? 0 : GAP,
                            padding: COLUMN_PAD - (picked ? RING_WIDTH : 0),
                            borderWidth: picked ? RING_WIDTH : 0,
                            borderColor: ring,
                            borderRadius: MAX_RADIUS,
                        }}
                    >
                        {grid.header ? (
                            <View style={{ marginBottom: GAP }}>
                                <Label
                                    text={grid.header[index] ?? ""}
                                    width={blockW}
                                    marginLeft={0}
                                    strong
                                />
                            </View>
                        ) : null}
                        {column.map((cell, block) => (
                            <View
                                key={cell?.key ?? `spacer-${block}`}
                                style={{
                                    marginTop: block === 0 ? 0 : BLOCK_GAP,
                                }}
                            >
                                <Square
                                    cell={cell}
                                    cells={cells}
                                    width={blockW}
                                    height={blockH}
                                    marginLeft={0}
                                    empty={String(colors.text)}
                                    ring={null}
                                />
                            </View>
                        ))}
                    </Pressable>
                );
            })}
        </View>
    );
}

function headerHeight(header: string[]): number {
    const lines = Math.max(...header.map((label) => label.split("\n").length));
    return lines * LINE_HEIGHT;
}

/** A small centered label over or under a square. */
function Label({
    text,
    width,
    marginLeft,
    strong,
}: {
    text: string;
    width: number;
    marginLeft: number;
    strong?: boolean;
}) {
    return (
        <Text
            className={
                strong
                    ? "text-center text-[11px] leading-[14px] font-medium"
                    : "text-muted-foreground text-center text-[10px] leading-[14px]"
            }
            style={{ width, marginLeft }}
            numberOfLines={2}
        >
            {text}
        </Text>
    );
}

/**
 * One square, filled by its heat in its tag's color. Without `onPress` it
 * is not a button, so a week's blocks pass taps to their column.
 */
function Square({
    cell,
    cells,
    width,
    height,
    marginLeft,
    empty,
    ring,
    onPress,
}: {
    cell: LayoutCell | null;
    cells: CellIndex;
    width: number;
    height: number;
    marginLeft: number;
    /** Fills an empty square, faintly. */
    empty: string;
    /** The selection ring's color, null when not picked. */
    ring: string | null;
    onPress?: () => void;
}) {
    const radius = Math.min(
        MAX_RADIUS,
        Math.max(2, Math.min(width, height) * 0.22),
    );
    if (!cell) return <View style={{ width, height, marginLeft }} />;

    const data = cells.byKey.get(cell.key);
    const plays = data?.plays ?? 0;
    const level = heatLevel(plays, cells.maxPlays);
    const color =
        (data?.tag_id != null
            ? cells.tagsById.get(data.tag_id)?.color
            : null) ?? UNTAGGED_COLOR;
    // a day outside the month is there for its shape only
    const outside = cell.pick === null;

    const body = (
        <>
            {/* the fill is its own layer, so its opacity does not fade the
                ring or the text with it */}
            <View
                style={[
                    StyleSheet.absoluteFill,
                    {
                        backgroundColor: level === 0 ? empty : color,
                        opacity:
                            level === 0
                                ? EMPTY_OPACITY * (outside ? 0.5 : 1)
                                : LEVEL_OPACITY[level],
                    },
                ]}
            />
            {cell.text ? (
                <View style={styles.textLayer} pointerEvents="none">
                    <RNText
                        style={[
                            styles.text,
                            {
                                fontSize: Math.max(
                                    9,
                                    Math.min(14, height * 0.32),
                                ),
                                opacity: outside ? 0.35 : 1,
                            },
                        ]}
                        numberOfLines={1}
                    >
                        {cell.text}
                    </RNText>
                </View>
            ) : null}
        </>
    );
    const style = {
        width,
        height,
        marginLeft,
        borderRadius: radius,
        overflow: "hidden" as const,
        borderWidth: ring ? RING_WIDTH : 0,
        borderColor: ring ?? undefined,
    };

    if (!onPress) return <View style={style}>{body}</View>;
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`${cell.pick?.label}, ${plays} plays`}
            accessibilityState={{ selected: ring != null }}
            style={style}
        >
            {body}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    textLayer: {
        ...StyleSheet.absoluteFill,
        alignItems: "center",
        justifyContent: "center",
    },
    text: {
        color: CELL_TEXT_COLOR,
        fontWeight: "600",
        textAlign: "center",
    },
});

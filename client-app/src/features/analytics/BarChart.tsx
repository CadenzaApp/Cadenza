import { useState } from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

import { axisCeiling, formatMetric, labelledIndices } from "./format";

export type Bar = {
    /** The bar's name, on the axis and in the headline when tapped. */
    label: string;
    value: number;
    /** What a screen reader says for the bar, e.g. "Sep 7: 61 plays". */
    readout: string;
};

type Props = {
    bars: Bar[];
    /** What the values are, for the headline and the value axis. */
    unit: "count" | "milliseconds";
    /** Under the headline when no bar is picked, e.g. "Total plays". */
    totalLabel: string;
    /** How many axis labels to show at most. */
    maxLabels?: number;
    /** Plot height in points. */
    height?: number;
    /** How wide one bar may get, so a short series reads as bars, not slabs. */
    maxBarWidth?: number;
    /** Bar color. The theme's chart color when absent. */
    color?: string | null;
    className?: string;
};

/** Width kept on the right of the plot for the value labels. */
const GUTTER = 36;
/** How much of its slot a bar fills; the rest is the gap between bars. */
const BAR_FILL = 0.68;
/** Width of one axis label, wide enough for "12 AM" or "Sep 30". */
const LABEL_WIDTH = 44;

/**
 * A single series of counts over an ordered axis, in the style of Screen Time.
 *
 * A headline on top shows the series total, or the tapped bar's value and
 * label. Bars spread over the full width whatever their count: the plot is
 * cut into one slot per bar and each bar is centered in its own, capped in
 * width. Gridlines at the top and middle of a rounded value axis carry their
 * values in a gutter on the right.
 *
 * Axis labels are placed under their bar's center rather than squeezed into
 * its slot, so a 24 bar day still reads "12 AM" in full, and the end labels
 * are held inside the plot.
 */
export function BarChart({
    bars,
    unit,
    totalLabel,
    maxLabels = 4,
    height = 140,
    maxBarWidth = 28,
    color,
    className,
}: Props) {
    const [selected, setSelected] = useState<number | null>(null);
    const [width, setWidth] = useState(0);

    if (bars.length === 0) return null;

    const max = Math.max(...bars.map((bar) => bar.value), 0);
    const ceiling = axisCeiling(max, unit);
    const total = bars.reduce((sum, bar) => sum + bar.value, 0);
    const active = selected != null ? bars[selected] : undefined;

    const plotWidth = Math.max(0, width - GUTTER);
    const slot = plotWidth / bars.length;
    const barWidth = Math.min(maxBarWidth, Math.max(2, slot * BAR_FILL));
    const labelled = labelledIndices(bars.length, maxLabels);

    return (
        <View
            className={cn("gap-3", className)}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        >
            {/* holds its height, so picking a bar does not shift the card */}
            <View>
                <Text className="text-2xl font-semibold">
                    {formatMetric(active ? active.value : total, unit)}
                </Text>
                <Text className="text-muted-foreground text-xs">
                    {active ? active.label : totalLabel}
                </Text>
            </View>

            {/* laid out against the measured width, so drawn only once known */}
            <View style={{ height }}>
                {width > 0 &&
                    [1, 0.5, 0].map((fraction) => (
                        <View
                            key={fraction}
                            className="absolute left-0 right-0 flex-row items-center"
                            // centered on the line, so the label sits beside it
                            style={{
                                top: (1 - fraction) * height - 7,
                                height: 14,
                            }}
                        >
                            <View
                                className={cn(
                                    "h-px",
                                    fraction === 0
                                        ? "bg-border"
                                        : "bg-border/50",
                                )}
                                style={{ width: plotWidth }}
                            />
                            {fraction > 0 ? (
                                <Text
                                    className="text-muted-foreground pl-1.5 text-[10px]"
                                    numberOfLines={1}
                                    style={{ width: GUTTER }}
                                >
                                    {formatMetric(ceiling * fraction, unit)}
                                </Text>
                            ) : null}
                        </View>
                    ))}

                {width > 0 &&
                    bars.map((bar, index) => {
                        const fraction = Math.min(1, bar.value / ceiling);
                        const isSelected = selected === index;
                        const dimmed = selected != null && !isSelected;
                        return (
                            // the touch target is the whole slot, so a near zero
                            // bar is still easy to hit
                            <Pressable
                                key={`${bar.label}-${index}`}
                                onPress={() =>
                                    setSelected(isSelected ? null : index)
                                }
                                className="absolute bottom-0 items-center justify-end"
                                style={{
                                    left: index * slot,
                                    width: slot,
                                    height,
                                }}
                                accessibilityRole="button"
                                accessibilityLabel={bar.readout}
                            >
                                <View
                                    className={cn(
                                        "rounded-t-sm",
                                        !color && "bg-chart-2",
                                        // a zero still draws a sliver, so an
                                        // empty bucket reads as measured
                                        fraction === 0 && "bg-border",
                                    )}
                                    style={{
                                        width: barWidth,
                                        height: Math.max(
                                            2,
                                            Math.round(fraction * height),
                                        ),
                                        opacity: dimmed ? 0.35 : 1,
                                        ...(color && fraction > 0
                                            ? { backgroundColor: color }
                                            : null),
                                    }}
                                />
                            </Pressable>
                        );
                    })}
            </View>

            <View style={{ height: 14 }}>
                {width > 0 &&
                    bars.map((bar, index) => {
                        if (!labelled.has(index)) return null;
                        const center = index * slot + slot / 2;
                        const left = Math.max(
                            0,
                            Math.min(
                                plotWidth - LABEL_WIDTH,
                                center - LABEL_WIDTH / 2,
                            ),
                        );
                        // a label held in at an edge lines up with that edge
                        const align =
                            left === 0 && center < LABEL_WIDTH / 2
                                ? "left"
                                : left === plotWidth - LABEL_WIDTH &&
                                    center > plotWidth - LABEL_WIDTH / 2
                                  ? "right"
                                  : "center";
                        return (
                            <Text
                                key={`label-${bar.label}-${index}`}
                                className="text-muted-foreground absolute text-[10px]"
                                numberOfLines={1}
                                style={{
                                    left,
                                    width: LABEL_WIDTH,
                                    textAlign: align,
                                }}
                            >
                                {bar.label}
                            </Text>
                        );
                    })}
            </View>
        </View>
    );
}

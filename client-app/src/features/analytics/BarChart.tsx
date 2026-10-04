import { useState } from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

import { labelledIndices } from "./format";

export type Bar = {
    /** The axis label for this bar. Not every bar shows one. */
    label: string;
    value: number;
    /** What a tap reads out, e.g. "Sep 7: 61 plays". */
    readout: string;
};

type Props = {
    bars: Bar[];
    /** How many axis labels to show at most. */
    maxLabels?: number;
    /** Plot height in pixels. */
    height?: number;
    /**
     * How wide one bar may get. Without a cap a short series stretches to fill
     * the plot, so a month of history under the All range draws as one slab
     * across the screen rather than as one bar.
     */
    maxBarWidth?: number;
    className?: string;
};

/**
 * A single series of counts over an ordered axis.
 *
 * One series, so one colour and no legend: the card title names what it is. Bars
 * are the right mark for a count per bucket, and the axis is already dense from
 * the backend, so a gap in the data reads as a zero-height bar rather than as
 * missing.
 *
 * Tapping a bar shows its value, which is this platform's version of a hover
 * tooltip. The touch target is the full column height, not just the filled part,
 * so a near-zero bar is still reachable.
 *
 * Bars are capped in width and the row is start aligned, so a short series reads
 * as a few bars on the left rather than stretching to fill the plot. A full
 * width slab is what a one-bucket chart used to look like.
 */
export function BarChart({
    bars,
    maxLabels = 5,
    height = 140,
    maxBarWidth = 28,
    className,
}: Props) {
    const [selected, setSelected] = useState<number | null>(null);
    const max = Math.max(...bars.map((bar) => bar.value), 0);
    const labelled = labelledIndices(bars.length, maxLabels);

    if (bars.length === 0) return null;

    const active = selected != null ? bars[selected] : undefined;

    return (
        <View className={cn("gap-2", className)}>
            {/* the readout sits above the plot so it never covers the bars, and
                holds its space so selecting one does not shift the layout */}
            <Text className="text-muted-foreground h-5 text-xs">
                {active ? active.readout : " "}
            </Text>

            <View className="flex-row items-end gap-0.5" style={{ height }}>
                {bars.map((bar, index) => {
                    const fraction = max > 0 ? bar.value / max : 0;
                    const isSelected = selected === index;
                    return (
                        <Pressable
                            key={`${bar.label}-${index}`}
                            onPress={() =>
                                setSelected(isSelected ? null : index)
                            }
                            className="flex-1 justify-end"
                            style={{ height, maxWidth: maxBarWidth }}
                            accessibilityRole="button"
                            accessibilityLabel={bar.readout}
                        >
                            <View
                                className={cn(
                                    "bg-chart-2 rounded-t",
                                    isSelected && "bg-chart-4",
                                    // a zero still draws a hairline, so an empty
                                    // bucket reads as measured rather than absent
                                    fraction === 0 && "bg-border",
                                )}
                                style={{
                                    height: Math.max(
                                        2,
                                        Math.round(fraction * height),
                                    ),
                                }}
                            />
                        </Pressable>
                    );
                })}
            </View>

            {/* recessive axis: a hairline and a few labels, never one per bar */}
            <View className="bg-border h-px w-full" />
            <View className="flex-row gap-0.5">
                {bars.map((bar, index) => (
                    <View
                        key={`label-${bar.label}-${index}`}
                        className="flex-1"
                        // the same cap as the bar above it, or the labels spread
                        // the full width while the bars sit left and every label
                        // names the wrong bar
                        style={{ maxWidth: maxBarWidth }}
                    >
                        {labelled.has(index) ? (
                            <Text
                                className="text-muted-foreground text-[10px]"
                                numberOfLines={1}
                            >
                                {bar.label}
                            </Text>
                        ) : null}
                    </View>
                ))}
            </View>
        </View>
    );
}

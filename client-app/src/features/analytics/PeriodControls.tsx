import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";

import { useAnalyticsPeriod } from "./analytics-period";
import {
    PERIOD_GRAINS,
    canStepBack,
    canStepForward,
    grainLabel,
} from "./range";

/** A glass pill naming the grain. Tapping it offers the others. */
export function GrainPicker() {
    const { period, setGrain } = useAnalyticsPeriod();
    const { colors } = useTheme();
    const [open, setOpen] = useState(false);

    return (
        <>
            <Pressable
                onPress={() => setOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={`Showing ${grainLabel(period.grain)}. Change`}
                hitSlop={6}
                style={({ pressed }) => (pressed ? styles.pressed : null)}
            >
                <View className="h-9 flex-row items-center gap-1 overflow-hidden rounded-full border border-border px-4">
                    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                        <GlassSurface style={StyleSheet.absoluteFill} />
                    </View>
                    <Text className="text-sm font-medium">
                        {grainLabel(period.grain)}
                    </Text>
                    <Ionicons
                        name="chevron-down"
                        size={14}
                        color={colors.text}
                    />
                </View>
            </Pressable>

            <ModalPopup
                visible={open}
                onClose={() => setOpen(false)}
                title="Show by"
            >
                {PERIOD_GRAINS.map((grain) => {
                    const selected = grain === period.grain;
                    return (
                        <Pressable
                            key={grain}
                            onPress={() => {
                                setOpen(false);
                                setGrain(grain);
                            }}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                            className="h-11 flex-row items-center justify-between"
                        >
                            <Text
                                className={
                                    selected
                                        ? "text-base font-semibold"
                                        : "text-base"
                                }
                            >
                                {grainLabel(grain)}
                            </Text>
                            {selected ? (
                                <Ionicons
                                    name="checkmark"
                                    size={18}
                                    color={colors.text}
                                />
                            ) : null}
                        </Pressable>
                    );
                })}
            </ModalPopup>
        </>
    );
}

/**
 * Back and forward a period. Forward is disabled on the current one, and both
 * hide for all time, which has nowhere to step.
 */
export function PeriodStepper({ size = 40 }: { size?: number }) {
    const { period, step } = useAnalyticsPeriod();
    const { colors } = useTheme();

    if (!canStepBack(period)) return null;
    const forward = canStepForward(period);

    return (
        <View className="flex-row items-center gap-2">
            <GlassIconButton
                size={size}
                onPress={() => step(-1)}
                accessibilityLabel={`Previous ${period.grain}`}
            >
                <Ionicons name="chevron-back" size={18} color={colors.text} />
            </GlassIconButton>
            <GlassIconButton
                size={size}
                onPress={() => step(1)}
                disabled={!forward}
                accessibilityLabel={`Next ${period.grain}`}
                accessibilityState={{ disabled: !forward }}
            >
                {/* dim the icon, not the button: liquid glass ignores a
                    parent's opacity, so a faded button still reads as live */}
                <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.text}
                    style={forward ? null : styles.disabled}
                />
            </GlassIconButton>
        </View>
    );
}

/**
 * The period in one row, for the detail pages: the dates, the grain, and the
 * arrows. The overview carries the same controls in its header instead.
 */
export function PeriodBar() {
    const { period } = useAnalyticsPeriod();
    return (
        <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1 flex-row items-center gap-3">
                <GrainPicker />
                <Text
                    className="text-muted-foreground flex-1 text-sm"
                    numberOfLines={1}
                >
                    {period.dateLabel}
                </Text>
            </View>
            <PeriodStepper size={36} />
        </View>
    );
}

const styles = StyleSheet.create({
    pressed: { opacity: 0.65 },
    disabled: { opacity: 0.25 },
});

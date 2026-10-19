import { useEffect, useId, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    interpolate,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import Svg, { Circle, ClipPath, Defs, Mask, Rect } from "react-native-svg";
import { useColorScheme } from "nativewind";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import type { QueryGroupMode } from "./types";

const MODES = ["all", "any", "none"] as const;

/** One compact visual language for outer logic, group logic, and exclusion. */
export function QuerySegmentedControl<T extends string>({
    value,
    options,
    onChange,
    label,
    segmentWidth = 44,
    segmentWidths,
    optionTextClassName = "text-sm font-bold text-foreground",
}: {
    value: T;
    options: readonly { value: T; label: string }[];
    onChange: (value: T) => void;
    label: string;
    segmentWidth?: number;
    segmentWidths?: readonly number[];
    optionTextClassName?: string;
}) {
    const { fontScale } = useWindowDimensions();
    const [width, setWidth] = useState(1);
    const [preview, setPreview] = useState<T | null>(null);
    const { colorScheme = "light" } = useColorScheme();
    const theme = THEME[colorScheme];
    const shown = preview ?? value;
    const reducedMotion = useReducedMotion();
    const position = useSharedValue(
        options.findIndex((option) => option.value === value),
    );
    useEffect(() => {
        position.set(
            withTiming(
                options.findIndex((option) => option.value === shown),
                { duration: reducedMotion ? 0 : 180 },
            ),
        );
    }, [shown, options, reducedMotion, position]);
    const naturalWidths = options.map(
        (_, index) =>
            (segmentWidths?.[index] ?? segmentWidth) * Math.max(1, fontScale),
    );
    const naturalTotal = naturalWidths.reduce((sum, value) => sum + value, 0);
    const widths = naturalWidths.map(
        (value) => (value * Math.max(0, width - 4)) / naturalTotal,
    );
    const offsets = widths.map((_, index) =>
        widths.slice(0, index).reduce((sum, value) => sum + value, 0),
    );
    const indices = options.map((_, index) => index);
    const indicatorStyle = useAnimatedStyle(() => ({
        width: interpolate(position.get(), indices, widths),
        transform: [
            { translateX: interpolate(position.get(), indices, offsets) },
        ],
    }));
    const at = (x: number) => {
        const index = offsets.findIndex(
            (offset, index) => x - 2 < offset + widths[index],
        );
        return options[index < 0 ? options.length - 1 : index].value;
    };
    const select = async (next: T) => {
        if (next === value) return;
        onChange(next);
        try {
            await Haptics.selectionAsync();
        } catch {
            /* Optional feedback. */
        }
    };
    const slide = Gesture.Pan()
        .activeOffsetX([-8, 8])
        .failOffsetY([-10, 10])
        .runOnJS(true)
        .onUpdate((event) => setPreview(at(event.x)))
        .onEnd((event) => {
            void select(at(event.x));
        })
        .onFinalize(() => setPreview(null));
    const tap = Gesture.Tap()
        .runOnJS(true)
        .onEnd((event, success) => {
            if (success) void select(at(event.x));
        });
    return (
        <GestureDetector gesture={Gesture.Race(slide, tap)}>
            <View
                onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
                accessibilityRole="radiogroup"
                accessibilityLabel={label}
                className="self-start flex-row rounded-full bg-secondary p-0.5"
                style={{
                    width: naturalTotal + 4,
                }}
            >
                <Animated.View
                    pointerEvents="none"
                    className="absolute bottom-0.5 left-0.5 top-0.5 rounded-full"
                    style={[
                        { backgroundColor: theme.background },
                        indicatorStyle,
                    ]}
                />
                {options.map((option, index) => (
                    <View
                        key={option.value}
                        accessible
                        accessibilityRole="radio"
                        accessibilityState={{ checked: value === option.value }}
                        accessibilityLabel={`${label}: ${option.label}`}
                        onAccessibilityTap={() => {
                            void select(option.value);
                        }}
                        className="min-h-6 items-center justify-center px-1 py-0"
                        style={{ width: naturalWidths[index] }}
                    >
                        <Text
                            numberOfLines={1}
                            className={optionTextClassName}
                            style={{
                                opacity: shown === option.value ? 1 : 0.72,
                                color:
                                    shown === option.value
                                        ? theme.foreground
                                        : theme.mutedForeground,
                            }}
                        >
                            {option.label}
                        </Text>
                    </View>
                ))}
            </View>
        </GestureDetector>
    );
}
const GROUP_OPTIONS = MODES.map((value) => ({
    value,
    label: value,
}));
export function GroupModeControl({
    mode,
    onChange,
}: {
    mode: QueryGroupMode;
    onChange: (mode: QueryGroupMode) => void;
}) {
    return (
        <View className="flex-row flex-wrap items-center gap-1">
            <Text className="text-sm font-bold text-foreground">have</Text>
            <View className="shrink-0">
                <QuerySegmentedControl
                    value={mode}
                    options={GROUP_OPTIONS}
                    onChange={onChange}
                    label="Have tags"
                    segmentWidths={[38, 38, 46]}
                />
            </View>
            <Text className="text-sm font-bold text-foreground">
                of the tags:
            </Text>
        </View>
    );
}

export function VennDiagram({
    mode,
    single = false,
}: {
    mode: QueryGroupMode;
    single?: boolean;
}) {
    const id = useId().replace(/[^a-zA-Z0-9]/g, "");
    const { colorScheme = "light" } = useColorScheme();
    const diagramColor = colorScheme === "dark" ? "#737373" : "#a3a3a3";
    return (
        <View
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
        >
            <Svg width={32} height={24} viewBox="0 0 48 36">
                {single ? (
                    <>
                        <Defs>
                            <Mask
                                id={`single${id}`}
                                maskUnits="userSpaceOnUse"
                                maskContentUnits="userSpaceOnUse"
                                x={0}
                                y={0}
                                width={48}
                                height={36}
                            >
                                <Rect width={48} height={36} fill="white" />
                                <Circle cx={24} cy={18} r={11} fill="black" />
                            </Mask>
                        </Defs>
                        {mode === "none" ? (
                            <Rect
                                x={1}
                                y={1}
                                width={46}
                                height={34}
                                rx={4}
                                fill={diagramColor}
                                mask={`url(#single${id})`}
                            />
                        ) : null}
                        <Rect
                            x={1}
                            y={1}
                            width={46}
                            height={34}
                            rx={4}
                            strokeOpacity={0.48}
                            stroke={diagramColor}
                            fill="none"
                        />
                        <Circle
                            cx={24}
                            cy={18}
                            r={11}
                            stroke={diagramColor}
                            fill={mode === "none" ? "none" : diagramColor}
                        />
                    </>
                ) : (
                    <>
                        <Defs>
                            <ClipPath id={`clip${id}`}>
                                <Circle cx={19} cy={18} r={11} />
                            </ClipPath>
                            <Mask
                                id={`mask${id}`}
                                maskUnits="userSpaceOnUse"
                                maskContentUnits="userSpaceOnUse"
                                x={0}
                                y={0}
                                width={48}
                                height={36}
                            >
                                <Rect width={48} height={36} fill="white" />
                                <Circle cx={19} cy={18} r={11} fill="black" />
                                <Circle cx={29} cy={18} r={11} fill="black" />
                            </Mask>
                        </Defs>
                        {mode === "none" ? (
                            <Rect
                                x={1}
                                y={1}
                                width={46}
                                height={34}
                                rx={4}
                                fill={diagramColor}
                                mask={`url(#mask${id})`}
                            />
                        ) : null}
                        {mode === "any" ? (
                            <>
                                <Circle
                                    cx={19}
                                    cy={18}
                                    r={11}
                                    fill={diagramColor}
                                />
                                <Circle
                                    cx={29}
                                    cy={18}
                                    r={11}
                                    fill={diagramColor}
                                />
                            </>
                        ) : null}
                        {mode === "all" ? (
                            <Circle
                                cx={29}
                                cy={18}
                                r={11}
                                fill={diagramColor}
                                clipPath={`url(#clip${id})`}
                            />
                        ) : null}
                        <Rect
                            x={1}
                            y={1}
                            width={46}
                            height={34}
                            rx={4}
                            strokeOpacity={0.48}
                            stroke={diagramColor}
                            fill="none"
                        />
                        <Circle
                            cx={19}
                            cy={18}
                            r={11}
                            stroke={diagramColor}
                            fill="none"
                        />
                        <Circle
                            cx={29}
                            cy={18}
                            r={11}
                            stroke={diagramColor}
                            fill="none"
                        />
                    </>
                )}
            </Svg>
        </View>
    );
}

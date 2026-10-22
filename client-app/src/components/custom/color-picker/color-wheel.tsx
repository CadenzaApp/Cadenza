import { LinearGradient } from "expo-linear-gradient";
import { useMemo, useState } from "react";
import {
    View,
    type AccessibilityActionEvent,
    type GestureResponderEvent,
    type LayoutChangeEvent,
} from "react-native";
import Svg, {
    Circle,
    Defs,
    Path,
    RadialGradient,
    Stop,
} from "react-native-svg";

import { hsvToHex, type HSV } from "@/lib/color-math";

/** Wedges the hue ring is drawn with. More is smoother and slower to draw. */
const WEDGES = 180;
const THUMB_SIZE = 30;
const SLIDER_HEIGHT = 32;
/** How far one screen reader swipe moves hue and brightness. */
const HUE_STEP = 15;
const BRIGHTNESS_STEP = 0.05;

const ADJUST_ACTIONS = [{ name: "increment" }, { name: "decrement" }];

/** +1 for a screen reader increment, -1 for a decrement. */
function adjustDirection(event: AccessibilityActionEvent) {
    return event.nativeEvent.actionName === "increment" ? 1 : -1;
}

type ColorWheelProps = {
    value: HSV;
    onChange: (value: HSV) => void;
    /** Diameter of the wheel in points. */
    size?: number;
};

/**
 * A hue and saturation wheel with a brightness slider under it. Hue runs
 * around the wheel, saturation from the white center out to the edge.
 * Controlled: it draws `value` and reports every drag through `onChange`.
 *
 * Works in HSV rather than hex so a drag through black or gray does not lose
 * the hue it started from.
 */
export function ColorWheel({ value, onChange, size = 280 }: ColorWheelProps) {
    return (
        <View className="items-center gap-6">
            <HueSaturationWheel value={value} onChange={onChange} size={size} />
            <BrightnessSlider value={value} onChange={onChange} width={size} />
        </View>
    );
}

function HueSaturationWheel({
    value,
    onChange,
    size,
}: Required<ColorWheelProps>) {
    const radius = size / 2;
    const wedges = useMemo(() => wheelWedges(radius), [radius]);
    const pick = (event: GestureResponderEvent) => {
        const { locationX, locationY } = event.nativeEvent;
        const dx = locationX - radius;
        const dy = locationY - radius;
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        onChange({
            h: (angle + 360) % 360,
            s: Math.min(1, Math.hypot(dx, dy) / radius),
            v: value.v,
        });
    };

    const angle = (value.h * Math.PI) / 180;
    const thumbX = radius + Math.cos(angle) * value.s * radius;
    const thumbY = radius + Math.sin(angle) * value.s * radius;

    return (
        <View
            style={{ width: size, height: size }}
            {...dragHandlers(pick)}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Hue"
            accessibilityValue={{ text: `${Math.round(value.h)} degrees` }}
            accessibilityActions={ADJUST_ACTIONS}
            onAccessibilityAction={(event) =>
                onChange({
                    ...value,
                    h:
                        (value.h + adjustDirection(event) * HUE_STEP + 360) %
                        360,
                })
            }
        >
            {/* nothing inside takes the touch, so locationX is the wheel's */}
            <View pointerEvents="none">
                <Svg width={size} height={size}>
                    <Defs>
                        <RadialGradient
                            id="wheelWhite"
                            cx="50%"
                            cy="50%"
                            r="50%"
                        >
                            <Stop
                                offset="0"
                                stopColor="#ffffff"
                                stopOpacity={1}
                            />
                            <Stop
                                offset="1"
                                stopColor="#ffffff"
                                stopOpacity={0}
                            />
                        </RadialGradient>
                    </Defs>
                    {wedges.map(({ d, fill }) => (
                        <Path key={d} d={d} fill={fill} />
                    ))}
                    <Circle
                        cx={radius}
                        cy={radius}
                        r={radius}
                        fill="url(#wheelWhite)"
                    />
                </Svg>
                {/* brightness darkens the whole wheel. a view over the svg, so
                    a brightness drag never redraws the wedges */}
                <View
                    className="absolute inset-0 rounded-full bg-black"
                    style={{ opacity: 1 - value.v }}
                />
                <Thumb x={thumbX} y={thumbY} color={hsvToHex(value)} />
            </View>
        </View>
    );
}

function BrightnessSlider({
    value,
    onChange,
    width,
}: {
    value: HSV;
    onChange: (value: HSV) => void;
    width: number;
}) {
    const [trackWidth, setTrackWidth] = useState(width);
    const pick = (event: GestureResponderEvent) => {
        const v = Math.min(
            1,
            Math.max(0, event.nativeEvent.locationX / trackWidth),
        );
        onChange({ ...value, v });
    };

    const fullBright = hsvToHex({ ...value, v: 1 });

    return (
        <View
            style={{ width, height: SLIDER_HEIGHT }}
            onLayout={(event: LayoutChangeEvent) =>
                setTrackWidth(event.nativeEvent.layout.width)
            }
            {...dragHandlers(pick)}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Brightness"
            accessibilityValue={{
                min: 0,
                max: 100,
                now: Math.round(value.v * 100),
            }}
            accessibilityActions={ADJUST_ACTIONS}
            onAccessibilityAction={(event) =>
                onChange({
                    ...value,
                    v: Math.min(
                        1,
                        Math.max(
                            0,
                            value.v + adjustDirection(event) * BRIGHTNESS_STEP,
                        ),
                    ),
                })
            }
        >
            <View pointerEvents="none" className="flex-1 justify-center">
                <LinearGradient
                    colors={["#000000", fullBright]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={{
                        height: SLIDER_HEIGHT,
                        borderRadius: SLIDER_HEIGHT / 2,
                    }}
                />
                <Thumb
                    x={Math.min(
                        trackWidth - SLIDER_HEIGHT / 2,
                        Math.max(SLIDER_HEIGHT / 2, value.v * trackWidth),
                    )}
                    y={SLIDER_HEIGHT / 2}
                    color={hsvToHex(value)}
                />
            </View>
        </View>
    );
}

/**
 * Responder props that report a press and every move after it, and keep the
 * gesture from a parent scroll view or sheet once it starts.
 */
function dragHandlers(pick: (event: GestureResponderEvent) => void) {
    return {
        onStartShouldSetResponder: () => true,
        onMoveShouldSetResponder: () => true,
        onResponderTerminationRequest: () => false,
        onResponderGrant: pick,
        onResponderMove: pick,
    };
}

/** A ringed circle filled with the picked color, centered on (x, y). */
function Thumb({ x, y, color }: { x: number; y: number; color: string }) {
    return (
        <View
            pointerEvents="none"
            className="absolute rounded-full border-[3px] border-white"
            style={{
                left: x - THUMB_SIZE / 2,
                top: y - THUMB_SIZE / 2,
                width: THUMB_SIZE,
                height: THUMB_SIZE,
                backgroundColor: color,
                shadowColor: "#000",
                shadowOpacity: 0.3,
                shadowRadius: 4,
                shadowOffset: { width: 0, height: 1 },
            }}
        />
    );
}

/**
 * The hue ring as pie wedges, each a solid hue. Each overlaps the next by a
 * little so no seam shows between them.
 */
function wheelWedges(radius: number) {
    const step = 360 / WEDGES;
    const point = (degrees: number) => {
        const radians = (degrees * Math.PI) / 180;
        return `${radius + Math.cos(radians) * radius} ${radius + Math.sin(radians) * radius}`;
    };
    return Array.from({ length: WEDGES }, (_, index) => {
        const start = index * step;
        const end = start + step + 0.6;
        return {
            d: `M ${radius} ${radius} L ${point(start)} A ${radius} ${radius} 0 0 1 ${point(end)} Z`,
            fill: hsvToHex({ h: start + step / 2, s: 1, v: 1 }),
        };
    });
}

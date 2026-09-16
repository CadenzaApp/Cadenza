import { useId } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Svg, {
    Defs,
    LinearGradient as SvgLinearGradient,
    Rect,
    Stop,
} from "react-native-svg";

type Point = { x: number; y: number };

type LinearGradientProps = {
    colors: readonly string[];
    locations?: readonly number[];
    start?: Point;
    end?: Point;
    style?: StyleProp<ViewStyle>;
    pointerEvents?: "auto" | "none" | "box-none" | "box-only";
};

/** A native-safe linear gradient backed by the app's existing SVG runtime. */
export function LinearGradient({
    colors,
    locations,
    start = { x: 0.5, y: 0 },
    end = { x: 0.5, y: 1 },
    style,
    pointerEvents,
}: LinearGradientProps) {
    const gradientId = `gradient-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const finalIndex = Math.max(colors.length - 1, 1);

    return (
        <Svg
            width="100%"
            height="100%"
            style={style}
            pointerEvents={pointerEvents}
        >
            <Defs>
                <SvgLinearGradient
                    id={gradientId}
                    x1={`${start.x * 100}%`}
                    y1={`${start.y * 100}%`}
                    x2={`${end.x * 100}%`}
                    y2={`${end.y * 100}%`}
                >
                    {colors.map((color, index) => (
                        <Stop
                            key={`${index}:${color}`}
                            offset={`${(locations?.[index] ?? index / finalIndex) * 100}%`}
                            stopColor={color}
                        />
                    ))}
                </SvgLinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
        </Svg>
    );
}

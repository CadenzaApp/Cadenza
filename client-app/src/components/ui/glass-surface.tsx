import { BlurView, type BlurTint } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { useColorScheme } from "nativewind";
import {
    Platform,
    StyleSheet,
    View,
    type ColorValue,
    type ViewProps,
} from "react-native";

import { cn } from "@/lib/utils";

/**
 * How solid the surface reads. `regular` is the default for bars that sit over
 * content. `clear` lets more through, for surfaces that should barely register.
 */
export type GlassSurfaceVariant = "regular" | "clear";

type GlassSurfaceProps = ViewProps & {
    variant?: GlassSurfaceVariant;
    /** Optional color washed into the glass. */
    tintColor?: ColorValue;
    /** Blur strength for the fallback path. Ignored when liquid glass renders. */
    intensity?: number;
};

/** Blur tints that read closest to liquid glass on each scheme. */
const FALLBACK_TINT: Record<"light" | "dark", BlurTint> = {
    light: "systemThickMaterialLight",
    dark: "systemThickMaterialDark",
};

const FALLBACK_INTENSITY: Record<GlassSurfaceVariant, number> = {
    regular: 60,
    clear: 35,
};

/**
 * A translucent background layer. Renders real liquid glass on iOS 26, a blur
 * on anything older, and a flat translucent card on web. Every floating bar in
 * the app draws its background through this, so swapping the implementation is
 * a one file change.
 *
 * It paints a background and nothing else. Give it a size, a radius, and
 * `overflow: "hidden"` from the caller. Note that clipping kills an iOS shadow,
 * so keep the shadow on a parent rather than on this view.
 */
export function GlassSurface({
    variant = "regular",
    tintColor,
    intensity,
    className,
    children,
    ...rest
}: GlassSurfaceProps) {
    const { colorScheme } = useColorScheme();
    const scheme = colorScheme === "dark" ? "dark" : "light";

    if (Platform.OS === "web") {
        return (
            <View className={cn("bg-card/80", className)} {...rest}>
                <FallbackTint color={tintColor} />
                {children}
            </View>
        );
    }

    if (isLiquidGlassAvailable()) {
        return (
            <GlassView
                glassEffectStyle={variant}
                colorScheme={scheme}
                tintColor={tintColor}
                className={className}
                {...rest}
            >
                {children}
            </GlassView>
        );
    }

    return (
        <BlurView
            tint={FALLBACK_TINT[scheme]}
            intensity={intensity ?? FALLBACK_INTENSITY[variant]}
            // Android's real blur needs a BlurTargetView wrapped around the
            // content behind it, which a global overlay cannot have. It falls
            // back to a semi-transparent fill instead.
            blurMethod={Platform.OS === "android" ? "none" : undefined}
            className={className}
            {...rest}
        >
            <FallbackTint color={tintColor} />
            {children}
        </BlurView>
    );
}

/** Approximates a custom glass tint where native liquid glass is unavailable. */
function FallbackTint({ color }: { color?: ColorValue }) {
    if (color == null) return null;

    return (
        <View
            pointerEvents="none"
            style={[
                StyleSheet.absoluteFill,
                { backgroundColor: color, opacity: 0.18 },
            ]}
        />
    );
}

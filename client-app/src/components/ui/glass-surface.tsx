import { BlurTargetView, BlurView, type BlurTint } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { useColorScheme } from "nativewind";
import {
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
    type RefObject,
} from "react";
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

type BlurTargetRef = RefObject<View | null>;

/**
 * The view Android glass at this point blurs, or null for none. A
 * `GlassBlurTarget` resets it to null for its own children.
 */
const BlurTargetContext = createContext<BlurTargetRef | null>(null);

/** How a `GlassBlurTarget` hands its ref up to the provider. */
const SetBlurTargetContext = createContext<
    ((target: BlurTargetRef | null) => void) | null
>(null);

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
 * Android 12 and up blurs only beside a `GlassBlurTarget`, under the same
 * `GlassBlurTargetProvider`. Any other Android glass paints a
 * semi-transparent fill.
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
    const blurTarget = useContext(BlurTargetContext);

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

    // iOS blurs whatever is behind the view, so only Android uses a target.
    // Below Android 12 the blur would copy the whole target into a bitmap
    // every frame, so the target is withheld there and the fill stays.
    const androidTarget =
        Platform.OS === "android" && Platform.Version >= 31 ? blurTarget : null;

    return (
        <BlurView
            tint={FALLBACK_TINT[scheme]}
            intensity={intensity ?? FALLBACK_INTENSITY[variant]}
            // Android blurs a target it samples, not what is behind the view.
            // Without one, "none" paints a semi-transparent fill.
            blurTarget={androidTarget ?? undefined}
            blurMethod={androidTarget ? "dimezisBlurViewSdk31Plus" : "none"}
            className={className}
            {...rest}
        >
            <FallbackTint color={tintColor} />
            {children}
        </BlurView>
    );
}

/**
 * Hands a `GlassBlurTarget` to the glass beside it. Mount it above both the
 * target and the glass that floats over the target.
 */
export function GlassBlurTargetProvider({ children }: { children: ReactNode }) {
    const [target, setTarget] = useState<BlurTargetRef | null>(null);

    return (
        <SetBlurTargetContext.Provider value={setTarget}>
            <BlurTargetContext.Provider value={target}>
                {children}
            </BlurTargetContext.Provider>
        </SetBlurTargetContext.Provider>
    );
}

/**
 * The content Android glass blurs. Wrap the content in this and render the
 * glass as a sibling under the same `GlassBlurTargetProvider`.
 *
 * Glass inside the target gets no target and keeps the fill. A blur view
 * inside the target it samples draws itself into the target, which draws the
 * blur view again, so it must never point at an ancestor.
 *
 * Only Android needs one. Everywhere else this renders its children alone.
 */
export function GlassBlurTarget({ children, ...rest }: ViewProps) {
    const setTarget = useContext(SetBlurTargetContext);
    const ref = useRef<View>(null);

    // Publish the ref only once it points at the native view. `BlurView`
    // re-reads its target when `current` changes between renders, so a ref
    // handed over while still empty would never be picked up.
    useEffect(() => {
        if (Platform.OS !== "android" || !setTarget) return;
        setTarget(ref);
        return () => setTarget(null);
    }, [setTarget]);

    if (Platform.OS !== "android") return <>{children}</>;

    return (
        <BlurTargetView ref={ref} {...rest}>
            <BlurTargetContext.Provider value={null}>
                {children}
            </BlurTargetContext.Provider>
        </BlurTargetView>
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

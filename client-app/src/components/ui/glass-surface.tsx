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

import { PALETTE, useOptionalAppTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * How solid the surface reads. `regular` is the default for bars that sit over
 * content. `clear` lets more through, for surfaces that should barely register.
 */
export type GlassSurfaceVariant = "regular" | "clear";

type GlassSurfaceProps = ViewProps & {
    /** Override the material appearance for an artwork-derived surface. */
    colorScheme?: "light" | "dark";
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

/**
 * True under a glass surface. Glass there paints a flat fill instead, since
 * liquid glass is not meant to stack on glass.
 */
const GlassLayerContext = createContext(false);

/**
 * How strongly nested glass paints `glassNestedFill`, a wash of the text
 * color. `regular` reads a step stronger than `clear`, so a pill still shows
 * on its track.
 */
const NESTED_FILL_OPACITY: Record<GlassSurfaceVariant, number> = {
    regular: 0.1,
    clear: 0.05,
};

/**
 * How strongly nested glass paints a tint its caller passes, like a toggle
 * that is on. Close to solid, as liquid glass draws a tint, so the color
 * reads true on a panel.
 */
const NESTED_TINT_OPACITY = 0.85;

const FALLBACK_INTENSITY: Record<GlassSurfaceVariant, number> = {
    regular: 60,
    clear: 35,
};

/**
 * Android glass has no live blur unless a `GlassBlurTarget` is mounted, so it
 * falls back to a near solid `card` fill. Raise the opacity toward 1 if
 * content still shows through too much.
 */
const ANDROID_FILL_OPACITY: Record<GlassSurfaceVariant, number> = {
    regular: 0.94,
    clear: 0.82,
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
 * Inside another glass surface, or a `GlassLayer`, it paints a flat fill
 * instead, since liquid glass is not meant to stack on glass.
 *
 * It paints a background and nothing else. Give it a size, a radius, and
 * `overflow: "hidden"` from the caller. Note that clipping kills an iOS shadow,
 * so keep the shadow on a parent rather than on this view.
 */
export function GlassSurface({
    colorScheme: surfaceScheme,
    variant = "regular",
    tintColor,
    intensity,
    className,
    children,
    ...rest
}: GlassSurfaceProps) {
    const { colorScheme } = useColorScheme();
    const appTheme = useOptionalAppTheme();
    // the app theme's scheme, so glass and its palette never disagree for a
    // frame while nativewind catches up
    const scheme =
        surfaceScheme ??
        appTheme?.scheme ??
        (colorScheme === "dark" ? "dark" : "light");
    const blurTarget = useContext(BlurTargetContext);
    const nested = useContext(GlassLayerContext);
    const userGlass = appTheme?.glass;
    // the app's own resolved colors, so a custom background reaches the
    // fallback fills. Artwork-colored glass keeps the stock palette
    const palette =
        appTheme && !surfaceScheme ? appTheme.colors : PALETTE[scheme];

    // the user's glass choices apply to top level glass in the app's own
    // colors. Glass on glass and artwork-colored glass keep their look, or the
    // wash would stack
    const followsUser = !nested && !surfaceScheme;
    const resolvedTint =
        tintColor ?? (followsUser ? (userGlass?.tint ?? undefined) : undefined);
    // Tinted dims glass toward the card color. Glass that brings its own color,
    // like a toggle on, keeps that color true
    const tintedFill =
        followsUser && tintColor == null && userGlass?.style === "tinted" ? (
            <TintedFill color={palette.card} />
        ) : null;

    // Everything below can hold children, so they learn they are on glass.
    const content = <GlassLayer>{children}</GlassLayer>;

    if (nested) {
        return (
            <View className={className} {...rest}>
                <View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFill,
                        {
                            backgroundColor: palette.glassNestedFill,
                            opacity: NESTED_FILL_OPACITY[variant],
                        },
                    ]}
                />
                <FallbackTint
                    color={resolvedTint}
                    opacity={NESTED_TINT_OPACITY}
                />
                {tintedFill}
                {content}
            </View>
        );
    }

    if (Platform.OS === "web") {
        return (
            <View
                className={cn("bg-card/80", className)}
                {...rest}
                style={[
                    rest.style,
                    surfaceScheme
                        ? { backgroundColor: palette.card + "cc" }
                        : undefined,
                ]}
            >
                <FallbackTint color={resolvedTint} />
                {tintedFill}
                {content}
            </View>
        );
    }

    if (isLiquidGlassAvailable()) {
        return (
            <GlassView
                glassEffectStyle={variant}
                colorScheme={scheme}
                tintColor={resolvedTint}
                className={className}
                {...rest}
            >
                {tintedFill}
                {content}
            </GlassView>
        );
    }

    // iOS blurs whatever is behind the view, so only Android uses a target.
    // Below Android 12 the blur would copy the whole target into a bitmap
    // every frame, so the target is withheld there and the fill stays.
    const androidTarget =
        Platform.OS === "android" && Platform.Version >= 31 ? blurTarget : null;

    // Android with nothing to blur: a translucent fill alone lets the content
    // underneath read straight through, so paint a mostly solid surface
    // instead. The frost look comes from opacity here, not a blur.
    if (Platform.OS === "android" && !androidTarget) {
        return (
            <View className={className} {...rest}>
                <View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFill,
                        {
                            backgroundColor: palette.card,
                            opacity: ANDROID_FILL_OPACITY[variant],
                        },
                    ]}
                />
                <FallbackTint color={resolvedTint} />
                {tintedFill}
                {content}
            </View>
        );
    }

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
            <FallbackTint color={resolvedTint} />
            {tintedFill}
            {content}
        </BlurView>
    );
}

/**
 * Marks its children as sitting on glass, so any glass among them paints a
 * flat fill. For a container whose glass is a sibling layer under its content
 * rather than the parent of it.
 */
export function GlassLayer({ children }: { children: ReactNode }) {
    return (
        <GlassLayerContext.Provider value={true}>
            {children}
        </GlassLayerContext.Provider>
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

/** How much of the card color Tinted glass lays over the glass. */
const TINTED_FILL_OPACITY = 0.55;

/** The extra opacity of Tinted glass. */
function TintedFill({ color }: { color: string }) {
    return (
        <View
            pointerEvents="none"
            style={[
                StyleSheet.absoluteFill,
                { backgroundColor: color, opacity: TINTED_FILL_OPACITY },
            ]}
        />
    );
}

/** Approximates a custom glass tint where native liquid glass is unavailable. */
function FallbackTint({
    color,
    opacity = 0.18,
}: {
    color?: ColorValue;
    opacity?: number;
}) {
    if (color == null) return null;

    return (
        <View
            pointerEvents="none"
            style={[
                StyleSheet.absoluteFill,
                { backgroundColor: color, opacity },
            ]}
        />
    );
}

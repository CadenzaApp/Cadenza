import Ionicons from "@expo/vector-icons/Ionicons";
import {
    createContext,
    useContext,
    useMemo,
    useState,
    type ComponentProps,
    type ReactNode,
} from "react";
import {
    View,
    type StyleProp,
    type ViewStyle,
    type LayoutChangeEvent,
} from "react-native";
import Animated, {
    runOnJS,
    useAnimatedReaction,
    useAnimatedStyle,
    useDerivedValue,
    useSharedValue,
    type SharedValue,
} from "react-native-reanimated";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
import {
    tintViewport,
    contrastPalette,
    oklabLightness,
    surfaceColorAt,
    type ArtworkSurface,
    type ContrastPalette,
} from "./artwork-color-utils";

type Surface = {
    colors: readonly string[];
    height: number;
    viewportHeight: number;
    contentHeight: number;
    scrollY: SharedValue<number>;
    artwork?: ArtworkSurface;
};
const SurfaceContext = createContext<Surface | null>(null);
const ForegroundContext = createContext<ContrastPalette | null>(null);

export function SurfaceContrastProvider({
    colors,
    height,
    viewportHeight,
    contentHeight,
    scrollY,
    artwork,
    children,
    style,
    onLayout,
}: Omit<Surface, "colors"> & {
    colors?: Surface["colors"];
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
    onLayout?: (event: LayoutChangeEvent) => void;
}) {
    const surface = useMemo(
        () =>
            colors
                ? {
                      colors,
                      height,
                      viewportHeight,
                      contentHeight,
                      scrollY,
                      artwork,
                  }
                : null,
        [colors, height, viewportHeight, contentHeight, scrollY, artwork],
    );
    return (
        <SurfaceContext.Provider value={surface}>
            <ContrastRegion offset={0}>
                <View
                    className="flex-1 bg-background"
                    onLayout={onLayout}
                    style={[
                        colors ? { backgroundColor: colors[0] } : undefined,
                        style,
                    ]}
                >
                    {children}
                </View>
            </ContrastRegion>
        </SurfaceContext.Provider>
    );
}

/** Offsets are in scroll-content coordinates, independent of the current scroll. */
export function ContrastRegion({
    offset,
    children,
}: {
    offset: number;
    children: ReactNode;
}) {
    const surface = useContext(SurfaceContext);
    const palette = useMemo(
        () =>
            surface
                ? contrastPalette(
                      surfaceColorAt(
                          surface.colors,
                          surface.height,
                          offset,
                          surface.artwork,
                      ),
                  )
                : null,
        [surface, offset],
    );
    return (
        <ForegroundContext.Provider value={palette}>
            {children}
        </ForegroundContext.Provider>
    );
}
export function useSurfacePalette() {
    return useContext(ForegroundContext);
}

/** Explicitly colored controls and solid button labels can retain their own palette. */
export function ContrastText({
    tone,
    style,
    className,
    ...props
}: ComponentProps<typeof Text> & { tone?: "primary" | "secondary" | "theme" }) {
    const palette = useSurfacePalette();
    const secondary =
        tone === "secondary" ||
        (!tone && className?.includes("text-muted-foreground"));
    const color =
        tone !== "theme" && palette
            ? secondary
                ? palette.secondary
                : palette.foreground
            : undefined;
    return (
        <Text
            {...props}
            className={className}
            style={[color ? { color } : undefined, style]}
        />
    );
}
export function ContrastIcon({
    color,
    ...props
}: ComponentProps<typeof Ionicons>) {
    const palette = useSurfacePalette();
    return <Ionicons {...props} color={palette?.foreground ?? color} />;
}

export function ContrastGlassIconButton(
    props: ComponentProps<typeof GlassIconButton>,
) {
    const palette = useSurfacePalette();
    return (
        <GlassIconButton
            {...props}
            surfaceScheme={props.surfaceScheme ?? palette?.scheme}
        />
    );
}

export const AnimatedContrastIcon = Animated.createAnimatedComponent(Ionicons);

/** Only material polarity changes cross to JS; scrolling color decisions stay on UI. */
export function useFloatingSurfaceContrast(screenY: number) {
    const surface = useContext(SurfaceContext);
    const [scheme, setScheme] = useState<"light" | "dark" | undefined>(
        undefined,
    );
    const spareScroll = useSharedValue(0);
    const scrollY = surface?.scrollY ?? spareScroll;
    const colors = surface?.colors;
    const height = surface?.height ?? 1;
    const artwork = surface?.artwork;
    const viewportHeight = surface?.viewportHeight ?? 1;
    const contentHeight = surface?.contentHeight ?? height;
    // Sample once per frame. Downstream styles and JS run only when polarity
    // changes, without calculating unused secondary text colors for this icon.
    const darkInk = useDerivedValue(() =>
        colors
            ? oklabLightness(
                  surfaceColorAt(
                      colors,
                      height,
                      tintViewport(contentHeight, viewportHeight, scrollY.get())
                          .offset + screenY,
                      artwork,
                  ),
              ) >= 0.5
            : null,
    );
    const iconStyle = useAnimatedStyle(() => {
        const dark = darkInk.get();
        return dark === null ? {} : { color: dark ? "#000000" : "#ffffff" };
    });
    useAnimatedReaction(
        () => darkInk.get(),
        (next, previous) => {
            if (next !== previous)
                runOnJS(setScheme)(
                    next === null ? undefined : next ? "light" : "dark",
                );
        },
    );
    return { iconStyle, scheme };
}

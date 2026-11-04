import MaskedView from "@react-native-masked-view/masked-view";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useMemo, type ComponentProps, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

/** Where a square cover sits in its box, in points. */
export type CoverFrame = { left: number; top: number; size: number };

/**
 * How the cover blends into the room above it, as fractions of its size. The
 * blurred copy fades in first, then the sharp one over it, so the edge goes
 * color, blur, image. The sharp one also gives way to the blur at the bottom,
 * before the whole box fades out.
 */
const BLUR_TOP_FEATHER = 0.06;
const SHARP_TOP_FEATHER = 0.16;
const SHARP_BOTTOM_FEATHER = 0.25;
/**
 * The sharp cover's top feather wanders up and down this much across its
 * width, as a fraction of its size, so the blur does not start on one flat
 * line. Drawn as this many columns, each its own gradient.
 */
const FEATHER_JITTER = 0.03;
const FEATHER_COLUMNS = 48;
/** Points. Run on the small copy, so it is cheap and already soft. */
const BLUR_RADIUS = 24;

type FadedArtworkProps = {
    /** Null shows `fallback` instead. */
    uri?: string | null;
    /** A smaller, likely cached copy shown while `uri` loads. */
    placeholderUri?: string | null;
    /** Fraction of the height where the bottom fade starts. */
    fadeStart: number;
    /**
     * Draw the cover whole at this frame, at least as wide as the box, and
     * fill the room above it from `edgeColors`. Left out, the image is cropped
     * to cover the box.
     */
    cover?: CoverFrame;
    /**
     * Colors of the cover's top edge, left to right, painted across the room
     * above `cover` so each part of the edge blends into its own color. Empty
     * leaves that room clear.
     */
    edgeColors?: readonly string[];
    /** Drawn under the same mask when there is no `uri`. */
    fallback?: ReactNode;
};

/**
 * Artwork filling its parent edge to edge that fades into whatever is behind
 * it at the bottom instead of ending on a hard line. Absolutely positioned, so
 * the caller sizes it.
 *
 * `expo-image` rather than the React Native one: it caches to disk, decodes off
 * the JS thread, and shows `placeholderUri` while the large image comes down.
 */
export function FadedArtwork({
    uri,
    placeholderUri,
    fadeStart,
    cover,
    edgeColors = [],
    fallback = null,
}: FadedArtworkProps) {
    return (
        <MaskedView
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            // Cache this static image+mask composite while the parent scrolls.
            shouldRasterizeIOS
            renderToHardwareTextureAndroid
            maskElement={
                <LinearGradient
                    style={StyleSheet.absoluteFill}
                    colors={["#000000", "#000000", "transparent"]}
                    locations={[0, fadeStart, 1]}
                />
            }
        >
            {!uri ? (
                fallback
            ) : cover ? (
                <BlendedCover
                    uri={uri}
                    placeholderUri={placeholderUri}
                    frame={cover}
                    edgeColors={edgeColors}
                />
            ) : (
                <Cover
                    uri={uri}
                    placeholderUri={placeholderUri}
                    style={StyleSheet.absoluteFill}
                />
            )}
        </MaskedView>
    );
}

/**
 * The cover at `frame` in three layers, bottom up: its edge colors across the
 * room above it, a blurred copy, and the sharp cover. Each fades in at the top
 * a little lower than the one under it, so the image dissolves into its own
 * colors instead of stopping on a line.
 */
function BlendedCover({
    uri,
    placeholderUri,
    frame,
    edgeColors,
}: {
    uri: string;
    placeholderUri?: string | null;
    frame: CoverFrame;
    edgeColors: readonly string[];
}) {
    const jitter = useMemo(
        () => smoothJitter(uri, FEATHER_COLUMNS, FEATHER_JITTER),
        [uri],
    );
    const square = {
        position: "absolute",
        left: frame.left,
        top: frame.top,
        width: frame.size,
        height: frame.size,
    } as const;

    return (
        <View style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
            <EdgeBand
                colors={edgeColors}
                height={frame.top + frame.size * SHARP_TOP_FEATHER}
            />
            <Feathered
                style={square}
                colors={["transparent", "#000000"]}
                locations={[0, BLUR_TOP_FEATHER]}
            >
                <Cover
                    uri={placeholderUri ?? uri}
                    blurRadius={BLUR_RADIUS}
                    style={StyleSheet.absoluteFill}
                />
            </Feathered>
            <Feathered
                style={square}
                colors={["transparent", "#000000", "#000000", "transparent"]}
                locations={[
                    BLUR_TOP_FEATHER,
                    SHARP_TOP_FEATHER,
                    1 - SHARP_BOTTOM_FEATHER,
                    1,
                ]}
                shifts={jitter}
            >
                <Cover
                    uri={uri}
                    placeholderUri={placeholderUri}
                    style={StyleSheet.absoluteFill}
                />
            </Feathered>
        </View>
    );
}

/**
 * `colors` side by side across the top `height` of the box, each centered on
 * its own strip and blended into its neighbors.
 */
function EdgeBand({
    colors,
    height,
}: {
    colors: readonly string[];
    height: number;
}) {
    if (colors.length === 0) return null;
    // a gradient needs two stops, so one color runs flat
    const stops = (colors.length === 1 ? [colors[0], colors[0]] : colors) as [
        string,
        string,
        ...string[],
    ];
    const locations = stops.map((_, index) => (index + 0.5) / stops.length) as [
        number,
        number,
        ...number[],
    ];
    return (
        <LinearGradient
            style={{ position: "absolute", left: 0, right: 0, top: 0, height }}
            colors={stops}
            locations={locations}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
        />
    );
}

/**
 * `count` offsets within `amount` of zero that drift smoothly from one to the
 * next. Seeded by `seed`, so one cover always gets the same edge.
 */
function smoothJitter(seed: string, count: number, amount: number) {
    let hash = 0;
    for (let index = 0; index < seed.length; index++) {
        hash = (hash * 31 + seed.charCodeAt(index)) | 0;
    }
    const phase = (shift: number) =>
        (((hash >>> shift) & 0xff) / 0xff) * 2 * Math.PI;
    const first = phase(0);
    const second = phase(8);
    return Array.from({ length: count }, (_, index) => {
        const x = index / count;
        // two slow waves, so it reads as uneven rather than as a pattern
        const wave =
            0.6 * Math.sin(2 * Math.PI * 1.3 * x + first) +
            0.4 * Math.sin(2 * Math.PI * 2.9 * x + second);
        return amount * wave;
    });
}

/**
 * `children` under a top to bottom alpha mask of `colors` at `locations`.
 * With `shifts`, the mask is that many columns, each with every inner stop
 * moved down by its shift, so the feather's edge is uneven across the width.
 * The first and last stops stay put.
 */
function Feathered({
    style,
    colors,
    locations,
    shifts = [0],
    children,
}: {
    style: ComponentProps<typeof View>["style"];
    colors: [string, string, ...string[]];
    locations: [number, number, ...number[]];
    shifts?: readonly number[];
    children: ReactNode;
}) {
    const last = locations.length - 1;
    return (
        <MaskedView
            style={style}
            maskElement={
                <View
                    style={[StyleSheet.absoluteFill, { flexDirection: "row" }]}
                >
                    {shifts.map((shift, column) => (
                        <LinearGradient
                            key={column}
                            style={{ flex: 1 }}
                            colors={colors}
                            locations={
                                locations.map((location, index) =>
                                    index === 0 || index === last
                                        ? location
                                        : Math.min(
                                              Math.max(location + shift, 0),
                                              1,
                                          ),
                                ) as [number, number, ...number[]]
                            }
                        />
                    ))}
                </View>
            }
        >
            {children}
        </MaskedView>
    );
}

function Cover({
    uri,
    placeholderUri,
    blurRadius,
    style,
}: {
    uri: string;
    placeholderUri?: string | null;
    blurRadius?: number;
    style: ComponentProps<typeof Image>["style"];
}) {
    return (
        <Image
            source={{ uri }}
            blurRadius={blurRadius}
            placeholder={placeholderUri ? { uri: placeholderUri } : undefined}
            placeholderContentFit="cover"
            contentFit="cover"
            cachePolicy="memory-disk"
            priority="high"
            transition={0}
            style={style}
        />
    );
}

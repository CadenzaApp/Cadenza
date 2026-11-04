import MaskedView from "@react-native-masked-view/masked-view";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import { memo, type ComponentProps, type ReactNode } from "react";
import { PixelRatio, StyleSheet, View } from "react-native";

/** Points the cover bleeds out past each of its edges. */
export const COVER_BLEED = 56;

/** One edge of the cover, and so the side its room is on. */
type Edge = "top" | "bottom" | "left" | "right";
const EDGES: readonly Edge[] = ["top", "bottom", "left", "right"];

/**
 * Each room is the cover's own edge, stretched out and flipped so it meets the
 * cover on the same row: `EDGE_STRIP` of the cover, as a fraction of its size.
 * Each layer out is blurred more than the one before it, so a column starts as
 * exactly the color beside it on the cover and mixes in more of its neighbors
 * the farther it goes.
 */
const EDGE_STRIP = 0.012;
/**
 * Blur of each stretched layer, from the cover out, in points. The first is
 * nearly sharp, so the row at the cover is its own color without streaking.
 */
const EDGE_BLURS = [2, 6, 12, 22, 36, 56];
/**
 * Steps each layer takes to fade in, so it overlaps the next one out and no
 * layer starts on a visible line.
 */
const EDGE_FADE_STEPS = 2.5;
/**
 * Points each room runs on under the cover. The strip's outermost row is
 * partly see through, and stretched 20 times it would show as a dark band at
 * the seam, so it is kept under the cover, which is drawn on top.
 */
const EDGE_OVERLAP = 12;
/** Points the strip is taken from inside the image edge, past its soft last row. */
const EDGE_INSET = 1;
/** Blur of the copy behind the rooms that fills the corners between them. */
const GLOW_BLUR = 40;
/**
 * Points the whole bleed takes to fade to nothing at its outer border, on
 * every side, so neither the glow nor a room ever ends on a line.
 */
const OUTER_FADE = 48;
/**
 * Points each room fades in over at its two ends, where it meets the glow in
 * the corners, so its sides are not a line either.
 */
const ROOM_END_FADE = 28;

type Direction = {
    start: { x: number; y: number };
    end: { x: number; y: number };
};
const ACROSS: Direction = { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } };
const DOWN: Direction = { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } };

/** Gradient direction from the cover out, for a mask on each side. */
const OUTWARD: Record<Edge, Direction> = {
    top: { start: { x: 0, y: 1 }, end: { x: 0, y: 0 } },
    bottom: { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } },
    left: { start: { x: 1, y: 0 }, end: { x: 0, y: 0 } },
    right: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
};

type BlendedCoverProps = {
    /** Null shows `fallback` instead, with no bleed. */
    uri?: string | null;
    /** A smaller, likely cached copy shown while `uri` loads, and blurred. */
    placeholderUri?: string | null;
    /** The cover's side, in points. The bleed draws outside it. */
    size: number;
    /** Drawn in the cover's square when there is no `uri`. */
    fallback?: ReactNode;
    /** Make the cover what a native zoom from a tile grows into. */
    zoomTarget?: boolean;
};

/**
 * A square cover that bleeds `COVER_BLEED` points out past every edge into
 * whatever is behind it: each edge stretched out and blurring as it goes
 * (`EdgeRoom`), over a blurred copy that fills the corners (`Glow`), all of it
 * fading to nothing at the bleed's border. Takes only the cover's square in layout; the bleed
 * overflows it.
 *
 * Memoized and rasterized: the bleed is about 30 masked views, drawn once and
 * cached, so keep the props stable or the page pays for them on every render.
 */
export const BlendedCover = memo(function BlendedCover({
    uri,
    placeholderUri,
    size,
    fallback = null,
    zoomTarget = false,
}: BlendedCoverProps) {
    const square = { width: size, height: size };
    const cover = uri ? (
        <Cover uri={uri} placeholderUri={placeholderUri} style={square} />
    ) : (
        <View style={square}>{fallback}</View>
    );

    return (
        <View style={square}>
            {uri ? (
                <View
                    pointerEvents="none"
                    // Cache the static bleed while the page scrolls.
                    shouldRasterizeIOS
                    renderToHardwareTextureAndroid
                    style={{
                        position: "absolute",
                        left: -COVER_BLEED,
                        top: -COVER_BLEED,
                        width: size + 2 * COVER_BLEED,
                        height: size + 2 * COVER_BLEED,
                    }}
                >
                    <BorderFade box={size + 2 * COVER_BLEED}>
                        <Cover
                            uri={placeholderUri ?? uri}
                            blurRadius={GLOW_BLUR}
                            style={StyleSheet.absoluteFill}
                        />
                        {EDGES.map((edge) => (
                            <EdgeRoom
                                key={edge}
                                uri={uri}
                                placeholderUri={placeholderUri}
                                size={size}
                                edge={edge}
                            />
                        ))}
                    </BorderFade>
                </View>
            ) : null}
            {/* Last, over the part of each room that runs under it. */}
            {zoomTarget ? (
                <Link.AppleZoomTarget>
                    <View collapsable={false}>{cover}</View>
                </Link.AppleZoomTarget>
            ) : (
                cover
            )}
        </View>
    );
});

/**
 * `children` fading to nothing over `OUTER_FADE` points at every side of a
 * `box` points square: one mask across, one down, so the corners fade both
 * ways.
 */
function BorderFade({ box, children }: { box: number; children: ReactNode }) {
    const fade = OUTER_FADE / box;
    const colors: [string, string, ...string[]] = [
        "transparent",
        "#000000",
        "#000000",
        "transparent",
    ];
    const locations: [number, number, ...number[]] = [0, fade, 1 - fade, 1];
    return (
        <Feathered
            style={StyleSheet.absoluteFill}
            direction={ACROSS}
            colors={colors}
            locations={locations}
        >
            <Feathered
                style={StyleSheet.absoluteFill}
                direction={DOWN}
                colors={colors}
                locations={locations}
            >
                {children}
            </Feathered>
        </Feathered>
    );
}

/**
 * The room past one `edge` of the cover, filled from that edge: one stretched
 * layer per `EDGE_BLURS` entry, each blurrier one fading in farther out. Its
 * two ends fade in over `ROOM_END_FADE`, onto the glow in the corners.
 */
function EdgeRoom({
    uri,
    placeholderUri,
    size,
    edge,
}: {
    uri: string;
    placeholderUri?: string | null;
    size: number;
    edge: Edge;
}) {
    const depth = COVER_BLEED + EDGE_OVERLAP;
    const vertical = edge === "top" || edge === "bottom";
    const near = COVER_BLEED + size - EDGE_OVERLAP;
    const frame = {
        position: "absolute",
        left: vertical ? COVER_BLEED : edge === "left" ? 0 : near,
        top: !vertical ? COVER_BLEED : edge === "top" ? 0 : near,
        width: vertical ? size : depth,
        height: vertical ? depth : size,
    } as const;
    // a fraction of the visible room, from the cover out, as one of the room
    const fromCover = (fraction: number) =>
        (EDGE_OVERLAP + fraction * COVER_BLEED) / depth;
    const step = 1 / EDGE_BLURS.length;
    const endFade = ROOM_END_FADE / size;

    return (
        <Feathered
            style={frame}
            direction={vertical ? ACROSS : DOWN}
            colors={["transparent", "#000000", "#000000", "transparent"]}
            locations={[0, endFade, 1 - endFade, 1]}
        >
            {EDGE_BLURS.map((blurRadius, layer) => {
                const stretched = (
                    <StretchedEdge
                        // the sharp layer is the exact edge, the blurred ones
                        // are cheaper and no worse from the small copy
                        uri={layer === 0 ? uri : (placeholderUri ?? uri)}
                        blurRadius={blurRadius}
                        size={size}
                        depth={depth}
                        edge={edge}
                    />
                );
                if (layer === 0) {
                    return (
                        <View key={layer} style={StyleSheet.absoluteFill}>
                            {stretched}
                        </View>
                    );
                }
                // gone a step nearer the cover, whole `EDGE_FADE_STEPS` later
                return (
                    <Feathered
                        key={layer}
                        style={StyleSheet.absoluteFill}
                        direction={OUTWARD[edge]}
                        colors={[
                            "transparent",
                            "transparent",
                            "#000000",
                            "#000000",
                        ]}
                        locations={[
                            0,
                            fromCover((layer - 1) * step),
                            fromCover(
                                Math.min(
                                    1,
                                    (layer - 1 + EDGE_FADE_STEPS) * step,
                                ),
                            ),
                            1,
                        ]}
                    >
                        {stretched}
                    </Feathered>
                );
            })}
        </Feathered>
    );
}

/**
 * `EDGE_STRIP` of the cover at `edge`, flipped and stretched to fill `depth`
 * points out from it, so the row that touches the cover is the cover's own.
 * Offsets are whole pixels so the strip's rows are not resampled across one.
 */
function StretchedEdge({
    uri,
    blurRadius,
    size,
    depth,
    edge,
}: {
    uri: string;
    blurRadius: number;
    size: number;
    depth: number;
    edge: Edge;
}) {
    const strip = PixelRatio.roundToNearestPixel(size * EDGE_STRIP);
    const vertical = edge === "top" || edge === "bottom";
    // the image's far side from the cover sits outside the strip
    const offset = PixelRatio.roundToNearestPixel(
        edge === "top" || edge === "left"
            ? -EDGE_INSET
            : strip - size + EDGE_INSET,
    );
    // centered, since the scale is about the view's center
    const center = (depth - strip) / 2;
    const scale = -depth / strip;

    return (
        <View
            style={{
                position: "absolute",
                left: vertical ? 0 : center,
                top: vertical ? center : 0,
                width: vertical ? size : strip,
                height: vertical ? strip : size,
                overflow: "hidden",
                transform: [vertical ? { scaleY: scale } : { scaleX: scale }],
            }}
        >
            <Cover
                uri={uri}
                blurRadius={blurRadius}
                style={{
                    position: "absolute",
                    left: vertical ? 0 : offset,
                    top: vertical ? offset : 0,
                    width: size,
                    height: size,
                }}
            />
        </View>
    );
}

/** `children` under an alpha mask of `colors` at `locations`, run along `direction`. */
function Feathered({
    style,
    direction,
    colors,
    locations,
    children,
}: {
    style: ComponentProps<typeof View>["style"];
    direction: Direction;
    colors: [string, string, ...string[]];
    locations: [number, number, ...number[]];
    children: ReactNode;
}) {
    return (
        <MaskedView
            style={style}
            maskElement={
                <LinearGradient
                    style={StyleSheet.absoluteFill}
                    start={direction.start}
                    end={direction.end}
                    colors={colors}
                    locations={locations}
                />
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

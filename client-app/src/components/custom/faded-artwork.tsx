import MaskedView from "@react-native-masked-view/masked-view";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useMemo, type ComponentProps, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

/** Where a square cover sits in its box, in points. */
export type CoverFrame = { left: number; top: number; size: number };

/**
 * The room above the cover is its own top edge, stretched up and flipped so it
 * meets the cover on the same row: `EDGE_STRIP` of the cover, as a fraction of
 * its size. Each layer up is blurred more than the one under it, so a column
 * starts as exactly the color above it on the cover and mixes in more of its
 * neighbors the higher it goes.
 */
const EDGE_STRIP = 0.012;
/** Blur of each stretched layer, bottom up, in points. The first is sharp. */
const EDGE_BLURS = [0, 4, 10, 20, 36];
/**
 * How far each layer's start wanders up and down across the width, as a
 * fraction of the room's height, so no blur starts on one flat line. Drawn as
 * this many columns, each its own gradient.
 */
const EDGE_JITTER = 0.08;
const EDGE_COLUMNS = 48;
/**
 * The sharp cover gives way to a blurred copy over this much of its bottom,
 * as a fraction of its size, before the whole box fades out.
 */
const SHARP_BOTTOM_FEATHER = 0.12;
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
     * fill the room above it from its own top edge. Left out, the image is
     * cropped to cover the box.
     */
    cover?: CoverFrame;
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
 * The cover at `frame` over a blurred copy it fades into at the bottom, with
 * its top edge stretched up through the room above it (`EdgeExtension`). The
 * cover itself is never blurred at the top, so all of it shows.
 */
function BlendedCover({
    uri,
    placeholderUri,
    frame,
}: {
    uri: string;
    placeholderUri?: string | null;
    frame: CoverFrame;
}) {
    const square = {
        position: "absolute",
        left: frame.left,
        top: frame.top,
        width: frame.size,
        height: frame.size,
    } as const;

    return (
        <View style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
            <EdgeExtension
                uri={uri}
                placeholderUri={placeholderUri}
                frame={frame}
            />
            <Cover
                uri={placeholderUri ?? uri}
                blurRadius={BLUR_RADIUS}
                style={square}
            />
            <Feathered
                style={square}
                width={frame.size}
                colors={["#000000", "#000000", "transparent"]}
                locations={[0, 1 - SHARP_BOTTOM_FEATHER, 1]}
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
 * The room above the cover, filled from the cover's top edge: one stretched
 * layer per `EDGE_BLURS` entry, each blurrier one fading in higher up. Nothing
 * when the cover starts at the top.
 */
function EdgeExtension({
    uri,
    placeholderUri,
    frame,
}: {
    uri: string;
    placeholderUri?: string | null;
    frame: CoverFrame;
}) {
    const jitter = useMemo(
        () => smoothJitter(uri, EDGE_COLUMNS, EDGE_JITTER),
        [uri],
    );
    if (frame.top <= 0) return null;

    const room = {
        position: "absolute",
        left: frame.left,
        top: 0,
        width: frame.size,
        height: frame.top,
    } as const;
    const step = 1 / EDGE_BLURS.length;

    return (
        <>
            {EDGE_BLURS.map((blurRadius, layer) => {
                const edge = (
                    <StretchedEdge
                        // the sharp layer is the exact edge, the blurred ones
                        // are cheaper and no worse from the small copy
                        uri={layer === 0 ? uri : (placeholderUri ?? uri)}
                        blurRadius={blurRadius}
                        frame={frame}
                    />
                );
                if (layer === 0) {
                    return (
                        <View key={layer} style={room}>
                            {edge}
                        </View>
                    );
                }
                // opaque above its start, gone a step below it
                const start = 1 - layer * step;
                return (
                    <Feathered
                        key={layer}
                        style={room}
                        width={frame.size}
                        colors={[
                            "#000000",
                            "#000000",
                            "transparent",
                            "transparent",
                        ]}
                        locations={[0, start, start + step, 1]}
                        shifts={jitter}
                    >
                        {edge}
                    </Feathered>
                );
            })}
        </>
    );
}

/**
 * The top `EDGE_STRIP` of the cover, flipped and stretched to fill the
 * `frame.top` points above it, so its bottom row is the cover's top row.
 */
function StretchedEdge({
    uri,
    blurRadius,
    frame,
}: {
    uri: string;
    blurRadius: number;
    frame: CoverFrame;
}) {
    const strip = frame.size * EDGE_STRIP;
    return (
        <View
            style={{
                position: "absolute",
                left: 0,
                // centered, since the scale is about the view's center
                top: (frame.top - strip) / 2,
                width: frame.size,
                height: strip,
                overflow: "hidden",
                transform: [{ scaleY: -frame.top / strip }],
            }}
        >
            <Cover
                uri={uri}
                blurRadius={blurRadius}
                style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: frame.size,
                    height: frame.size,
                }}
            />
        </View>
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
 * The first and last stops stay put. Columns overlap by a point so no seam
 * shows between them.
 */
function Feathered({
    style,
    width,
    colors,
    locations,
    shifts = [0],
    children,
}: {
    style: ComponentProps<typeof View>["style"];
    /** The masked view's width, to lay the columns out by. */
    width: number;
    colors: [string, string, ...string[]];
    locations: [number, number, ...number[]];
    shifts?: readonly number[];
    children: ReactNode;
}) {
    const last = locations.length - 1;
    const columnWidth = width / shifts.length;
    return (
        <MaskedView
            style={style}
            maskElement={
                <View style={StyleSheet.absoluteFill}>
                    {shifts.map((shift, column) => (
                        <LinearGradient
                            key={column}
                            style={{
                                position: "absolute",
                                top: 0,
                                bottom: 0,
                                left: column * columnWidth,
                                width:
                                    columnWidth +
                                    (column < shifts.length - 1 ? 1 : 0),
                            }}
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

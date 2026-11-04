import MaskedView from "@react-native-masked-view/masked-view";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { memo, type ComponentProps, type ReactNode } from "react";
import { PixelRatio, StyleSheet, View } from "react-native";

/**
 * Where a square cover sits in its box, in points, and how much room its box
 * leaves below it.
 */
export type CoverFrame = {
    left: number;
    top: number;
    size: number;
    /** Points below the cover, filled from its bottom edge. */
    below: number;
};

/** Which edge of the cover an `EdgeExtension` stretches, and so where. */
type Edge = "top" | "bottom";

/**
 * The room above and below the cover is its own edge, stretched out and
 * flipped so it meets the cover on the same row: `EDGE_STRIP` of the cover, as
 * a fraction of its size. Each layer out is blurred more than the one before
 * it, so a column starts as exactly the color beside it on the cover and mixes
 * in more of its neighbors the farther it goes.
 */
const EDGE_STRIP = 0.012;
/** Blur of each stretched layer, from the cover out, in points. The first is sharp. */
const EDGE_BLURS = [0, 4, 10, 20, 36];
/**
 * Points each room runs on under the cover. The strip's outermost row is
 * partly see through, and stretched 20 times it would show as a dark band at
 * the seam, so it is kept under the cover, which is drawn on top.
 */
const EDGE_OVERLAP = 12;
/** Points the strip is taken from inside the image edge, past its soft last row. */
const EDGE_INSET = 1;

type FadedArtworkProps = {
    /** Null shows `fallback` instead. */
    uri?: string | null;
    /** A smaller, likely cached copy shown while `uri` loads. */
    placeholderUri?: string | null;
    /** Fraction of the height where the bottom fade starts. */
    fadeStart: number;
    /**
     * Draw the cover whole at this frame, at least as wide as the box, and
     * fill the room above and below it from its own edges. Left out, the image is
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
 *
 * Memoized: any update to a view under the rasterized mask throws its cached
 * bitmap away, and the page re-renders while it scrolls (content size, paging,
 * playback). Keep `cover` and `fallback` stable so it renders once.
 */
export const FadedArtwork = memo(function FadedArtwork({
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
});

/**
 * The cover at `frame`, sharp edge to edge, with its top and bottom edges
 * stretched out through the room on each side (`EdgeExtension`). The cover is
 * drawn last, over the part of each room that runs under it.
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
    return (
        <View style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
            <EdgeExtension
                uri={uri}
                placeholderUri={placeholderUri}
                frame={frame}
                edge="top"
            />
            <EdgeExtension
                uri={uri}
                placeholderUri={placeholderUri}
                frame={frame}
                edge="bottom"
            />
            <Cover
                uri={uri}
                placeholderUri={placeholderUri}
                style={{
                    position: "absolute",
                    left: frame.left,
                    top: frame.top,
                    width: frame.size,
                    height: frame.size,
                }}
            />
        </View>
    );
}

/**
 * The room past one `edge` of the cover, filled from that edge: one stretched
 * layer per `EDGE_BLURS` entry, each blurrier one fading in farther out.
 * Nothing when there is no room on that side.
 */
function EdgeExtension({
    uri,
    placeholderUri,
    frame,
    edge,
}: {
    uri: string;
    placeholderUri?: string | null;
    frame: CoverFrame;
    edge: Edge;
}) {
    const visible = edge === "top" ? frame.top : frame.below;
    if (visible <= 0) return null;

    const height = visible + EDGE_OVERLAP;
    const room = {
        position: "absolute",
        left: frame.left,
        top: edge === "top" ? 0 : frame.top + frame.size - EDGE_OVERLAP,
        width: frame.size,
        height,
    } as const;
    // a fraction of the visible room, from the cover out, as one of the room
    const fromCover = (fraction: number) =>
        (EDGE_OVERLAP + fraction * visible) / height;
    const step = 1 / EDGE_BLURS.length;

    return (
        <>
            {EDGE_BLURS.map((blurRadius, layer) => {
                const stretched = (
                    <StretchedEdge
                        // the sharp layer is the exact edge, the blurred ones
                        // are cheaper and no worse from the small copy
                        uri={layer === 0 ? uri : (placeholderUri ?? uri)}
                        blurRadius={blurRadius}
                        size={frame.size}
                        height={height}
                        edge={edge}
                    />
                );
                if (layer === 0) {
                    return (
                        <View key={layer} style={room}>
                            {stretched}
                        </View>
                    );
                }
                // opaque from `layer` steps out, gone a step nearer the cover
                return (
                    <Feathered
                        key={layer}
                        style={room}
                        edge={edge}
                        near={fromCover((layer - 1) * step)}
                        far={fromCover(layer * step)}
                    >
                        {stretched}
                    </Feathered>
                );
            })}
        </>
    );
}

/**
 * `EDGE_STRIP` of the cover at `edge`, flipped and stretched to fill `height`
 * points past it, so the row that touches the cover is the cover's own.
 * Offsets are whole pixels so the strip's rows are not resampled across one.
 */
function StretchedEdge({
    uri,
    blurRadius,
    size,
    height,
    edge,
}: {
    uri: string;
    blurRadius: number;
    size: number;
    height: number;
    edge: Edge;
}) {
    const strip = PixelRatio.roundToNearestPixel(size * EDGE_STRIP);
    return (
        <View
            style={{
                position: "absolute",
                left: 0,
                // centered, since the scale is about the view's center
                top: (height - strip) / 2,
                width: size,
                height: strip,
                overflow: "hidden",
                transform: [{ scaleY: -height / strip }],
            }}
        >
            <Cover
                uri={uri}
                blurRadius={blurRadius}
                style={{
                    position: "absolute",
                    left: 0,
                    top: PixelRatio.roundToNearestPixel(
                        edge === "top"
                            ? -EDGE_INSET
                            : strip - size + EDGE_INSET,
                    ),
                    width: size,
                    height: size,
                }}
            />
        </View>
    );
}

/**
 * `children` gone up to `near` and whole from `far`, fading between, both
 * fractions of the view from the edge that touches the cover.
 */
function Feathered({
    style,
    edge,
    near,
    far,
    children,
}: {
    style: ComponentProps<typeof View>["style"];
    edge: Edge;
    near: number;
    far: number;
    children: ReactNode;
}) {
    return (
        <MaskedView
            style={style}
            maskElement={
                <LinearGradient
                    style={StyleSheet.absoluteFill}
                    // the top room touches the cover at its bottom
                    start={{ x: 0, y: edge === "top" ? 1 : 0 }}
                    end={{ x: 0, y: edge === "top" ? 0 : 1 }}
                    colors={[
                        "transparent",
                        "transparent",
                        "#000000",
                        "#000000",
                    ]}
                    locations={[0, near, far, 1]}
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

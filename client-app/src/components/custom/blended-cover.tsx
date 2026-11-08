import MaskedView from "@react-native-masked-view/masked-view";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { memo, useId, type ComponentProps, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Svg, {
    Defs,
    LinearGradient,
    RadialGradient,
    Rect,
    Stop,
} from "react-native-svg";

/** Points the cover bleeds out past each of its edges. */
export const COVER_BLEED = 56;

/** Corner radius of the cover, as a fraction of its side. */
const COVER_RADIUS = 0.14;

/** Blur of the copy that makes the bleed. */
const GLOW_BLUR = 60;
/** Opacity of the bleed where it meets the cover. */
const GLOW_OPACITY = 0.85;
/** Stops in the falloff, enough that the easing reads as a curve. */
const FALLOFF_STOPS = 9;

/**
 * Opacity of the bleed at `t`, its distance from the cover over `COVER_BLEED`:
 * full at the cover, eased out to nothing at the border, flat at both ends so
 * neither one shows a line.
 */
function falloff(t: number) {
    const smooth = t * t * (3 - 2 * t);
    return GLOW_OPACITY * (1 - smooth);
}

const FALLOFF = Array.from({ length: FALLOFF_STOPS }, (_, i) => {
    const t = i / (FALLOFF_STOPS - 1);
    return { offset: t, opacity: falloff(t) };
});

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
 * A squircle cover over a blurred, enlarged copy of itself that bleeds
 * `COVER_BLEED` points out past every edge (`Glow`). Takes only the cover's
 * square in layout; the bleed overflows it.
 *
 * Memoized and rasterized: keep the props stable, since a new render redoes
 * the blur and throws the cached bitmap away.
 */
export const BlendedCover = memo(function BlendedCover({
    uri,
    placeholderUri,
    size,
    fallback = null,
    zoomTarget = false,
}: BlendedCoverProps) {
    const square = { width: size, height: size };
    // continuous corners, so the rounding is a squircle, not a quarter circle
    const squircle = {
        ...square,
        borderRadius: size * COVER_RADIUS,
        borderCurve: "continuous",
        overflow: "hidden",
    } as const;
    const cover = uri ? (
        <Cover uri={uri} placeholderUri={placeholderUri} style={squircle} />
    ) : (
        <View style={squircle}>{fallback}</View>
    );

    return (
        <View style={square}>
            {uri ? <Glow uri={placeholderUri ?? uri} size={size} /> : null}
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
 * The cover blurred and grown to fill the bleed, under a mask that fades with
 * distance from the cover's square: one linear ramp per side, one radial ramp
 * per corner, all on the same `FALLOFF`, so the fade is a rounded square with
 * no seams and no lines at the border.
 */
function Glow({ uri, size }: { uri: string; size: number }) {
    // svg ids go in url(#id), which the characters useId makes can break
    const id = `glow${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
    // whole points, so the pieces of the mask meet on a pixel boundary
    const side = Math.round(size);
    const b = COVER_BLEED;
    const box = side + 2 * b;
    const near = b;
    const far = b + side;

    const stops = (key: string) =>
        FALLOFF.map(({ offset, opacity }) => (
            <Stop
                key={`${key}${offset}`}
                offset={offset}
                stopColor="#000"
                stopOpacity={opacity}
            />
        ));
    // a ramp from the cover's edge at `from` out to the border at `to`
    const ramp = (
        key: string,
        from: [number, number],
        to: [number, number],
    ) => (
        <LinearGradient
            id={`${id}${key}`}
            gradientUnits="userSpaceOnUse"
            x1={from[0]}
            y1={from[1]}
            x2={to[0]}
            y2={to[1]}
        >
            {stops(key)}
        </LinearGradient>
    );
    const corner = (key: string, cx: number, cy: number) => (
        <RadialGradient
            id={`${id}${key}`}
            gradientUnits="userSpaceOnUse"
            cx={cx}
            cy={cy}
            r={b}
            fx={cx}
            fy={cy}
        >
            {stops(key)}
        </RadialGradient>
    );
    const fill = (key: string) => `url(#${id}${key})`;

    return (
        <View
            pointerEvents="none"
            // the hero scales every scroll frame, and a live mask would be
            // redrawn offscreen each time: cache the masked result instead
            shouldRasterizeIOS
            renderToHardwareTextureAndroid
            style={{
                position: "absolute",
                left: -b,
                top: -b,
                width: box,
                height: box,
            }}
        >
            <MaskedView
                style={StyleSheet.absoluteFill}
                maskElement={
                    <Svg width={box} height={box}>
                        <Defs>
                            {ramp("t", [0, near], [0, 0])}
                            {ramp("b", [0, far], [0, box])}
                            {ramp("l", [near, 0], [0, 0])}
                            {ramp("r", [far, 0], [box, 0])}
                            {corner("tl", near, near)}
                            {corner("tr", far, near)}
                            {corner("bl", near, far)}
                            {corner("br", far, far)}
                        </Defs>
                        <Rect
                            x={near}
                            y={near}
                            width={side}
                            height={side}
                            fill="#000"
                            fillOpacity={GLOW_OPACITY}
                        />
                        <Rect
                            x={near}
                            y={0}
                            width={side}
                            height={b}
                            fill={fill("t")}
                        />
                        <Rect
                            x={near}
                            y={far}
                            width={side}
                            height={b}
                            fill={fill("b")}
                        />
                        <Rect
                            x={0}
                            y={near}
                            width={b}
                            height={side}
                            fill={fill("l")}
                        />
                        <Rect
                            x={far}
                            y={near}
                            width={b}
                            height={side}
                            fill={fill("r")}
                        />
                        <Rect
                            x={0}
                            y={0}
                            width={b}
                            height={b}
                            fill={fill("tl")}
                        />
                        <Rect
                            x={far}
                            y={0}
                            width={b}
                            height={b}
                            fill={fill("tr")}
                        />
                        <Rect
                            x={0}
                            y={far}
                            width={b}
                            height={b}
                            fill={fill("bl")}
                        />
                        <Rect
                            x={far}
                            y={far}
                            width={b}
                            height={b}
                            fill={fill("br")}
                        />
                    </Svg>
                }
            >
                <Cover
                    uri={uri}
                    blurRadius={GLOW_BLUR}
                    style={StyleSheet.absoluteFill}
                />
            </MaskedView>
        </View>
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

import { converter, formatHex } from "culori";

const toOklch = converter("oklch");
const toOklab = converter("oklab");
const toRgb = converter("rgb");

/** Perceptual Oklab average of the available six-digit hex artwork colors. */
export function averageArtworkColors(
    colors: readonly (string | null | undefined)[],
) {
    const validColors = colors.filter(
        (color): color is string =>
            typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color),
    );
    if (validColors.length === 0) return null;

    const oklabColors = validColors.map((color) => toOklab(color));
    if (oklabColors.some((color) => !color)) return null;
    const average = (channel: "l" | "a" | "b") =>
        oklabColors.reduce(
            (total, color) => total + (color?.[channel] ?? 0),
            0,
        ) / oklabColors.length;

    return (
        formatHex(
            toRgb({
                mode: "oklab",
                l: average("l"),
                a: average("a"),
                b: average("b"),
            }),
        ) ?? null
    );
}

const TINT_GRADIENT_STOP_COUNT = 9;

type ColorScheme = "dark" | "light";

export type TintGradient = {
    /** Ordered native-renderer stops, from the surface's top to its bottom. */
    readonly colors: readonly [string, string, ...string[]];
};

/**
 * How far a point has moved from the top color toward the end color, from how
 * far down the page it is (0 at the top, 1 at the bottom).
 *
 * The top color keeps a 1/x share with x = 1 + depth, so 1 at the top and 1/2
 * at the bottom. Thus a long page eases off and stops halfway to the end color,
 * rather than running into it.
 */
export function tintFadeAt(depth: number) {
    return 1 - 1 / (1 + Math.max(0, Math.min(1, depth)));
}

/**
 * The shared mode-aware Oklch tint at `depth` down a page, 0 at the top and 1
 * at the bottom. See `tintFadeAt` for the curve.
 */
export function sampleTintGradientColor(
    hex: string,
    colorScheme: ColorScheme,
    depth: number,
) {
    const color = toOklch(hex);
    if (!color) return hex;

    const fade = tintFadeAt(depth);
    const start = {
        l: colorScheme === "light" ? color.l + (1 - color.l) * 0.475 : color.l,
        c: colorScheme === "light" ? color.c * 0.75 : color.c * 0.6,
    };
    const end = {
        l:
            colorScheme === "dark"
                ? color.l * 0.1
                : color.l + (1 - color.l) * 0.9,
        c: color.c * 0.2,
    };

    return (
        formatHex(
            toRgb({
                ...color,
                l: start.l + (end.l - start.l) * fade,
                c: start.c + (end.c - start.c) * fade,
            }),
        ) ?? hex
    );
}

/**
 * Samples a tinted page gradient in Oklch, top to bottom, then returns RGB
 * stops for the native renderer. Meant to run the whole page's length. In dark
 * mode, the top preserves its lightness and retains 60% of its chroma. In
 * light mode, it moves 47.5% toward white and retains 75% of its chroma. The
 * end color retains 20% of its chroma and sits near the mode's page
 * background; the bottom of the page gets halfway there.
 */
export function createTintGradient(
    hex: string,
    colorScheme: ColorScheme,
): TintGradient {
    return {
        colors: Array.from({ length: TINT_GRADIENT_STOP_COUNT }, (_, index) =>
            sampleTintGradientColor(
                hex,
                colorScheme,
                index / (TINT_GRADIENT_STOP_COUNT - 1),
            ),
        ) as unknown as TintGradient["colors"],
    };
}

/**
 * A color evened out to glow in the nebula behind a page. Lightness is held to
 * a band per mode and chroma is capped, so a near black tag still shows on a
 * dark page and a neon one reads as a soft glow rather than a light.
 */
export function nebulaColor(hex: string, colorScheme: ColorScheme) {
    const color = toOklch(hex);
    if (!color) return hex;

    const [minL, maxL, maxC] =
        colorScheme === "dark" ? [0.5, 0.68, 0.16] : [0.72, 0.86, 0.12];
    return (
        formatHex(
            toRgb({
                ...color,
                l: Math.max(minL, Math.min(maxL, color.l)),
                c: Math.min(maxC, color.c),
            }),
        ) ?? hex
    );
}

/**
 * How far apart two colors have to be in Oklab to count as different. Close
 * to the smallest step the eye picks up, so two near identical browns from
 * different covers count as one.
 */
const DISTINCT_COLOR_DISTANCE = 0.04;

/**
 * The first `count` colors in `candidates` that differ from every one picked
 * before them, in order. Skips anything that is not six-digit hex. May return
 * fewer than `count` when the candidates run out.
 */
export function distinctColors(
    candidates: readonly (string | null | undefined)[],
    count: number,
    minDistance = DISTINCT_COLOR_DISTANCE,
): string[] {
    const picked: { hex: string; lab: { l: number; a: number; b: number } }[] =
        [];
    for (const hex of candidates) {
        if (picked.length >= count) break;
        if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) continue;
        const lab = toOklab(hex);
        if (!lab) continue;
        const repeat = picked.some(
            (seen) =>
                Math.hypot(
                    seen.lab.l - lab.l,
                    seen.lab.a - lab.a,
                    seen.lab.b - lab.b,
                ) < minDistance,
        );
        if (!repeat) picked.push({ hex, lab });
    }
    return picked.map((color) => color.hex);
}

/** Fade the portrait over most of its height, independently of the page color. */
export const ARTIST_ARTWORK_FADE_START = 0.2;
export const ARTIST_GRADIENT_SCREEN_HEIGHTS = 3;

/** Start at the portrait sample; approach a quieter mode-appropriate Oklch shade. */
export function createArtistGradient(
    hex: string,
    scheme: "dark" | "light",
): TintGradient {
    const color = toOklch(hex);
    if (!color) return { colors: [hex, hex] };
    const endL =
        scheme === "dark" ? color.l * 0.15 : color.l + (1 - color.l) * 0.92;
    const endC = color.c * 0.12;
    const stops = Array.from({ length: 8 }, (_, index) => {
        const depth = (index + 1) / 8;
        return (
            formatHex({
                ...color,
                l: color.l + (endL - color.l) * depth,
                c: color.c + (endC - color.c) * depth,
            }) ?? hex
        );
    });
    return { colors: [hex, stops[0], ...stops.slice(1)] };
}

/** Oklab lightness and surface sampling, also callable from scroll worklets. */
export type ContrastPalette = {
    foreground: string;
    secondary: string;
    scheme: "light" | "dark";
};
export type ArtworkSurface = {
    color: string;
    height: number;
    fadeStart?: number;
};

function channel(hex: string, start: number) {
    "worklet";
    return parseInt(hex.slice(start, start + 2), 16) / 255;
}
function linear(channel: number) {
    "worklet";
    return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
}

/** Standard linear-sRGB to Oklab L, in the perceptual range 0..1. */
export function oklabLightness(hex: string) {
    "worklet";
    const r = linear(channel(hex, 1));
    const g = linear(channel(hex, 3));
    const b = linear(channel(hex, 5));
    const l = Math.cbrt(
        0.412221469470763 * r + 0.5363325372617348 * g + 0.0514459932675022 * b,
    );
    const m = Math.cbrt(
        0.2119034958178252 * r +
            0.6806995506452344 * g +
            0.1073969535369406 * b,
    );
    const s = Math.cbrt(
        0.0883024591900564 * r +
            0.2817188391361215 * g +
            0.6299787016738222 * b,
    );
    return (
        0.210454268309314 * l + 0.7936177747023054 * m - 0.0040720430116193 * s
    );
}
function byteHex(value: number) {
    "worklet";
    return Math.round(Math.min(1, Math.max(0, value)) * 255)
        .toString(16)
        .padStart(2, "0");
}

/** Neutral secondary text retains 75% of the primary's Oklab L separation. */
export function contrastPalette(background: string): ContrastPalette {
    "worklet";
    const l = oklabLightness(background);
    const darkInk = l >= 0.5;
    const secondaryL = darkInk ? l * 0.25 : 1 - (1 - l) * 0.25;
    const neutral = secondaryL ** 3;
    const srgb =
        neutral <= 0.0031308
            ? neutral * 12.92
            : 1.055 * neutral ** (1 / 2.4) - 0.055;
    const hex = byteHex(srgb);
    return {
        foreground: darkInk ? "#000000" : "#ffffff",
        secondary: `#${hex}${hex}${hex}`,
        scheme: darkInk ? "light" : "dark",
    };
}

/** Match the native gradient's sRGB interpolation before judging Oklab L. */
export function mixSurfaceColor(a: string, b: string, fraction: number) {
    "worklet";
    const t = Math.max(0, Math.min(1, fraction));
    let hex = "#";
    for (let start = 1; start < 7; start += 2) {
        const first = channel(a, start);
        hex += byteHex(first + (channel(b, start) - first) * t);
    }
    return hex;
}
export function gradientColorAt(colors: readonly string[], depth: number) {
    "worklet";
    if (colors.length === 0) return "#000000";
    const position = Math.max(0, Math.min(1, depth)) * (colors.length - 1);
    const index = Math.floor(position);
    return mixSurfaceColor(
        colors[index],
        colors[Math.min(index + 1, colors.length - 1)],
        position - index,
    );
}

/** A content-space offset stays on the same gradient color as the page scrolls. */
export function surfaceColorAt(
    colors: readonly string[],
    contentHeight: number,
    offset: number,
    artwork?: ArtworkSurface,
) {
    "worklet";
    const height = Math.max(1, contentHeight);
    if (artwork && offset < artwork.height) {
        const start = artwork.fadeStart ?? 0.55;
        const fade =
            (offset / Math.max(1, artwork.height) - start) / (1 - start);
        return mixSurfaceColor(
            artwork.color,
            gradientColorAt(colors, offset / height),
            fade,
        );
    }
    return gradientColorAt(colors, offset / height);
}

/** Keep one content-height gradient covering the viewport, including rubber banding. */
export function tintViewport(
    contentHeight: number,
    viewportHeight: number,
    scrollY: number,
    gradientMinHeight = 0,
) {
    "worklet";
    const height = Math.max(0, contentHeight, viewportHeight);
    return {
        height: Math.max(height, gradientMinHeight),
        offset: Math.max(0, Math.min(scrollY, height - viewportHeight)),
    };
}

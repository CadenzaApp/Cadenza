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

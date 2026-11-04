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

type ColorScheme = "dark" | "light";

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
 * `count` square regions of an image, each `size` of it on a side, at spots
 * picked at random but seeded by `seed`, so one image always gives the same
 * spots and so the same colors.
 */
export function randomImageRegions(
    seed: string,
    count: number,
    size: number,
): { x: number; y: number; width: number; height: number }[] {
    // mulberry32, seeded from a string hash
    let state = 0;
    for (let index = 0; index < seed.length; index++) {
        state = (Math.imul(state, 31) + seed.charCodeAt(index)) | 0;
    }
    const next = () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return Array.from({ length: count }, () => ({
        x: next() * (1 - size),
        y: next() * (1 - size),
        width: size,
        height: size,
    }));
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

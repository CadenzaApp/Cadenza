/** The brown and gray choices that complete the hue palette. */
export const TAG_NEUTRAL_COLOR_OPTIONS = ["#8c5939", "#6b7281"] as const;

/** The brighter yellow swatch, which is intended to use dark foreground text. */
export const TAG_YELLOW_COLOR = "#dc8f00";

/** Curated chromatic choices, ordered by ascending Oklch hue. */
export const TAG_CHROMATIC_COLOR_OPTIONS = [
    "#b01843",
    "#f22933",
    "#ee5300",
    TAG_YELLOW_COLOR,
    "#6f9808",
    "#00a446",
    "#00907f",
    "#0092b4",
    "#2061f1",
    "#6d35d5",
    "#ae6ff1",
    "#dd34e5",
    "#f83ca0",
] as const;

/**
 * Accessible tag colors, stored as RGB hex. The curated chromatic colors are
 * ordered by hue, followed by brown and gray. Every color has at least 4.5:1
 * contrast against its preferred black or white foreground. All but the
 * intentionally brighter yellow also have at least 3:1 against both.
 */
export const TAG_COLOR_OPTIONS: readonly string[] = [
    ...TAG_CHROMATIC_COLOR_OPTIONS,
    ...TAG_NEUTRAL_COLOR_OPTIONS,
] as const;

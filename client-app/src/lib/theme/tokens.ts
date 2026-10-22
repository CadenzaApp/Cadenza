/**
 * Every app color, in one place. `global.css` mirrors the CSS tokens as
 * defaults for nativewind classes, and `tokens.test.ts` fails if the two drift.
 * At runtime `AppThemeProvider` resolves a palette, applies the user's
 * overrides, and hands it to both classes (as CSS variables) and JS readers
 * (through `useAppTheme`). Kept free of imports so it can be unit tested.
 */

export type ColorScheme = "light" | "dark";

export type Palette = {
    background: string;
    foreground: string;
    card: string;
    cardForeground: string;
    popover: string;
    popoverForeground: string;
    primary: string;
    primaryForeground: string;
    secondary: string;
    secondaryForeground: string;
    muted: string;
    mutedForeground: string;
    /** shadcn's neutral highlight, for pressed rows. Not the user's color. */
    accent: string;
    accentForeground: string;
    destructive: string;
    destructiveForeground: string;
    border: string;
    input: string;
    ring: string;
    /** The user's accent: toggles, avatar, icon tiles, highlights. */
    brand: string;
    brandForeground: string;
    success: string;
    /** Like and heart icons. */
    like: string;
    /** What nested glass washes with. Read only from JS. */
    glassNestedFill: string;
};

export type ThemeColorToken = keyof Palette;

/** Tokens that are also CSS variables, so classes like `bg-card` can use them. */
export const CSS_TOKENS = [
    "background",
    "foreground",
    "card",
    "cardForeground",
    "popover",
    "popoverForeground",
    "primary",
    "primaryForeground",
    "secondary",
    "secondaryForeground",
    "muted",
    "mutedForeground",
    "accent",
    "accentForeground",
    "destructive",
    "destructiveForeground",
    "border",
    "input",
    "ring",
    "brand",
    "brandForeground",
    "success",
] as const satisfies readonly ThemeColorToken[];

/** The default accent, the same coral in both schemes. */
export const DEFAULT_BRAND = "#ff6467";

export const PALETTE: Record<ColorScheme, Palette> = {
    light: {
        background: "#ffffff",
        foreground: "#0a0a0a",
        card: "#fcfcfc",
        cardForeground: "#0a0a0a",
        popover: "#fcfcfc",
        popoverForeground: "#0a0a0a",
        primary: "#171717",
        primaryForeground: "#fafafa",
        secondary: "#ededed",
        secondaryForeground: "#171717",
        muted: "#f5f5f5",
        mutedForeground: "#737373",
        accent: "#f5f5f5",
        accentForeground: "#171717",
        destructive: "#e7000b",
        destructiveForeground: "#ffffff",
        border: "#e5e5e5",
        input: "#e5e5e5",
        ring: "#a1a1a1",
        brand: DEFAULT_BRAND,
        brandForeground: "#ffffff",
        success: "#22c55e",
        like: "#e11d48",
        glassNestedFill: "#000000",
    },
    dark: {
        background: "#0a0a0a",
        foreground: "#fafafa",
        card: "#171717",
        cardForeground: "#fafafa",
        popover: "#171717",
        popoverForeground: "#fafafa",
        primary: "#e5e5e5",
        primaryForeground: "#171717",
        secondary: "#262626",
        secondaryForeground: "#fafafa",
        muted: "#262626",
        mutedForeground: "#a1a1a1",
        accent: "#404040",
        accentForeground: "#fafafa",
        destructive: "#ff6467",
        destructiveForeground: "#fafafa",
        border: "#282828",
        input: "#343434",
        ring: "#737373",
        brand: DEFAULT_BRAND,
        brandForeground: "#ffffff",
        success: "#4ade80",
        like: "#e11d48",
        glassNestedFill: "#ffffff",
    },
};

/**
 * The two ends of the Apple Music icon's gradient, bottom to top. Brand
 * colors, the same in both schemes.
 */
export const APPLE_MUSIC_GRADIENT = ["#fa233b", "#fb5c74"] as const;

/**
 * The accent colors a new user starts with, after the fixed default. Apple's
 * system hues, which read well on both schemes.
 */
export const ACCENT_PRESETS: readonly string[] = [
    "#ff9f0a", // orange
    "#30d158", // green
    "#40c8e0", // teal
    "#0a84ff", // blue
    "#bf5af2", // purple
];

/** The glass tints a new user starts with, after the fixed "none". Softer. */
export const GLASS_TINT_PRESETS: readonly string[] = [
    "#ff8fab", // rose
    "#ffb38a", // peach
    "#66d9a8", // mint
    "#6cc4ff", // sky
    "#b69cff", // lavender
];

/** Backgrounds a new user starts with for the custom mode. */
export const BACKGROUND_PRESETS: readonly string[] = [
    "#101a2f", // midnight blue
    "#222326", // graphite
    "#1d1426", // aubergine
    "#fcf0f3", // blush
    "#fbf6e9", // cream
    "#edf1f6", // mist
];

/** `cardForeground` becomes `--card-foreground`. */
export function cssVarName(token: ThemeColorToken): string {
    return `--${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** Relative luminance above this reads as a light background. */
const LIGHT_BACKGROUND_LUMINANCE = 0.35;

/** How far each surface moves from a custom background toward the text. */
const SURFACE_MIX: Partial<Record<ThemeColorToken, number>> = {
    card: 0.05,
    popover: 0.05,
    muted: 0.1,
    secondary: 0.1,
    accent: 0.14,
    border: 0.12,
    input: 0.16,
};

/** Light text on a dark background, dark text on a light one. */
export function schemeForBackground(background: string): ColorScheme {
    const [r, g, b] = hexChannels(background).map((channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > LIGHT_BACKGROUND_LUMINANCE ? "light" : "dark";
}

/**
 * The palette for `scheme`, with the user's accent as `brand` and, for the
 * custom mode, their background with every surface mixed from it.
 */
export function resolvePalette(
    scheme: ColorScheme,
    overrides: { accent: string | null; background?: string | null },
): Palette {
    let palette = PALETTE[scheme];
    if (overrides.background) {
        const background = overrides.background;
        const surfaces = Object.fromEntries(
            Object.entries(SURFACE_MIX).map(([token, amount]) => [
                token,
                mixHex(background, palette.foreground, amount),
            ]),
        );
        palette = { ...palette, ...surfaces, background };
    }
    return overrides.accent ? { ...palette, brand: overrides.accent } : palette;
}

function hexChannels(hex: string): [number, number, number] {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** `from` moved `amount` of the way to `to`, both `#rrggbb`. */
function mixHex(from: string, to: string, amount: number): string {
    const a = hexChannels(from);
    const b = hexChannels(to);
    return `#${a
        .map((channel, i) =>
            Math.round(channel + (b[i] - channel) * amount)
                .toString(16)
                .padStart(2, "0"),
        )
        .join("")}`;
}

/** The CSS variables for a palette, for nativewind's `vars()`. */
export function paletteCssVars(palette: Palette): Record<string, string> {
    return Object.fromEntries(
        CSS_TOKENS.map((token) => [cssVarName(token), palette[token]]),
    );
}

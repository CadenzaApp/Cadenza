/**
 * Hue, saturation, value and hex conversions for the color picker. Kept free
 * of imports so it can be unit tested without React Native.
 */

/** `h` in degrees 0 to 360, `s` and `v` 0 to 1. */
export type HSV = { h: number; s: number; v: number };

const HEX_COLOR = /^#[0-9a-f]{6}$/;

/** `#rrggbb` lowercased, from text with or without the `#`, or null. */
export function normalizeHex(text: string): string | null {
    const trimmed = text.trim().toLowerCase();
    const hex = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    return HEX_COLOR.test(hex) ? hex : null;
}

export function hsvToHex({ h, s, v }: HSV): string {
    const hue = (((h % 360) + 360) % 360) / 60;
    const chroma = v * s;
    const x = chroma * (1 - Math.abs((hue % 2) - 1));
    const [r, g, b] =
        hue < 1
            ? [chroma, x, 0]
            : hue < 2
              ? [x, chroma, 0]
              : hue < 3
                ? [0, chroma, x]
                : hue < 4
                  ? [0, x, chroma]
                  : hue < 5
                    ? [x, 0, chroma]
                    : [chroma, 0, x];
    const m = v - chroma;
    const channel = (value: number) =>
        Math.round((value + m) * 255)
            .toString(16)
            .padStart(2, "0");
    return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** The HSV of a `#rrggbb` color. A gray has hue 0. */
export function hexToHsv(hex: string): HSV {
    const value = parseInt(hex.slice(1), 16);
    const r = ((value >> 16) & 255) / 255;
    const g = ((value >> 8) & 255) / 255;
    const b = (value & 255) / 255;
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);

    let h = 0;
    if (delta > 0) {
        if (max === r) h = 60 * (((g - b) / delta) % 6);
        else if (max === g) h = 60 * ((b - r) / delta + 2);
        else h = 60 * ((r - g) / delta + 4);
    }
    return { h: (h + 360) % 360, s: max === 0 ? 0 : delta / max, v: max };
}

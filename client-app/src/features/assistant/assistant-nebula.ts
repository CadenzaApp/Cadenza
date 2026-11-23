/**
 * The colors of the nebula behind the assistant sheet, from the user's accent.
 * Kept free of React Native so it can be unit tested.
 */

import { hexToHsv, hsvToHex } from "../../lib/color-math.ts";

/**
 * The two colors that glow beside the accent: its hue turned by `turn`
 * degrees, a little softer and darker, so the backdrop has depth without
 * competing with it. A gray accent stays gray.
 */
const COMPANIONS = [
    { turn: 40, saturation: 0.85, value: 0.95 },
    { turn: -110, saturation: 0.7, value: 0.85 },
] as const;

/** The accent first, then its two companions. `accent` is `#rrggbb`. */
export function assistantNebulaColors(accent: string): string[] {
    const base = hexToHsv(accent);
    return [
        accent,
        ...COMPANIONS.map(({ turn, saturation, value }) =>
            hsvToHex({
                h: base.h + turn,
                s: base.s * saturation,
                v: base.v * value,
            }),
        ),
    ];
}

import Svg, { Ellipse, G, Path, Rect } from "react-native-svg";

import { CADENZA_LOGO } from "@/lib/theme";

/**
 * The Cadenza note: a stem and head, with the flag set apart. Shapes from
 * `assets/images/cadenza-logo.svg`, framed tight to the art so `size` is the
 * note's height.
 */
export function CadenzaLogo({ size = 96 }: { size?: number }) {
    return (
        <Svg
            width={size}
            height={size}
            viewBox="95 95 610 610"
            accessibilityRole="image"
            accessibilityLabel="Cadenza"
        >
            <G transform="translate(137.70994 47.483446)">
                <Rect
                    x="206"
                    y="48"
                    width="80"
                    height="485.914171"
                    fill={CADENZA_LOGO.note}
                />
                <Ellipse
                    cx="155.78406"
                    cy="555.009537"
                    rx="134"
                    ry="97"
                    transform="rotate(-20 155.78406 555.009537)"
                    fill={CADENZA_LOGO.note}
                />
                <Path
                    transform="translate(11.012 0)"
                    d="M296 48h56l136 135-58 58-134-134V48Z"
                    fill={CADENZA_LOGO.flag}
                />
            </G>
        </Svg>
    );
}

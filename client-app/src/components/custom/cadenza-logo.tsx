import { useId } from "react";
import Svg, {
    Defs,
    Ellipse,
    FeGaussianBlur,
    Filter,
    G,
    Path,
    Rect,
} from "react-native-svg";

import { CADENZA_LOGO } from "@/lib/theme";

/** The art's own frame in the logo's 800 unit box. */
const FRAME = { origin: 95, side: 610 };

/**
 * The Cadenza note: a stem and head, with the flag set apart. Shapes from
 * `assets/images/cadenza-logo.svg`, framed tight to the art so `size` is the
 * note's height. `blur`, in the svg's units (the note is 610 tall), softens
 * it; the frame grows to fit, so the note draws a little smaller.
 */
export function CadenzaLogo({
    size = 96,
    blur = 0,
}: {
    size?: number;
    blur?: number;
}) {
    // svg ids go in url(#id), which the characters useId makes can break
    const filterId = `cadenzaBlur${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
    // a gaussian reaches about 3 deviations, so leave that much room
    const pad = blur * 3;
    const viewBox = [
        FRAME.origin - pad,
        FRAME.origin - pad,
        FRAME.side + pad * 2,
        FRAME.side + pad * 2,
    ].join(" ");

    return (
        <Svg
            width={size}
            height={size}
            viewBox={viewBox}
            accessibilityRole="image"
            accessibilityLabel="Cadenza"
        >
            {blur > 0 ? (
                <Defs>
                    <Filter
                        id={filterId}
                        filterUnits="userSpaceOnUse"
                        x={FRAME.origin - pad}
                        y={FRAME.origin - pad}
                        width={FRAME.side + pad * 2}
                        height={FRAME.side + pad * 2}
                    >
                        <FeGaussianBlur stdDeviation={blur} />
                    </Filter>
                </Defs>
            ) : null}
            <G filter={blur > 0 ? `url(#${filterId})` : undefined}>
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
            </G>
        </Svg>
    );
}

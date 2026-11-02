import { Link } from "expo-router";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    FadedArtwork,
    type CoverFrame,
} from "@/components/custom/faded-artwork";

/**
 * Apple's album page, measured on a 393pt phone: the cover is 1.05 screen
 * widths and centered, so a few points crop off each side. Its top sits 42pt
 * under the status bar, with a flipped copy above it, and it fades out over
 * the bottom 28% of the hero.
 */
const COVER_SCALE = 1.05;
const COVER_TOP_GAP = 42;
const COVER_FADE_START = 0.72;

export type CoverHeroLayout = {
    /** Where the cover itself sits inside the hero. */
    cover: CoverFrame;
    /** The hero's full height: the room above the cover plus the cover. */
    height: number;
    /** Fraction of `height` where the fade starts. */
    fadeStart: number;
};

/** The hero's geometry for a screen `width` wide under a `safeTop` inset. */
export function coverHeroLayout(
    width: number,
    safeTop: number,
): CoverHeroLayout {
    const size = width * COVER_SCALE;
    const top = safeTop + COVER_TOP_GAP;
    return {
        cover: { left: (width - size) / 2, top, size },
        height: top + size,
        fadeStart: COVER_FADE_START,
    };
}

/** `coverHeroLayout` for this window and its safe area. */
export function useCoverHeroLayout() {
    const { width } = useWindowDimensions();
    const { top } = useSafeAreaInsets();
    return coverHeroLayout(width, top);
}

type CoverHeroProps = {
    layout: CoverHeroLayout;
    /** Null draws `fallback` instead. */
    uri?: string | null;
    placeholderUri?: string | null;
    fallback?: ReactNode;
    /** Make the cover what a native zoom from a tile grows into. */
    zoomTarget?: boolean;
    /** Drawn over the bottom of the hero, on the fade, like the title. */
    children?: ReactNode;
};

/**
 * A square cover run past both edges and up under the status bar, fading into
 * the page at the bottom, with `children` over the fade. For the album,
 * playlist, and artist pages. The page under it should be one flat color
 * (`useCoverPageColor`) so the fade lands on what the rest of the page is.
 */
export function CoverHero({
    layout,
    uri,
    placeholderUri,
    fallback,
    zoomTarget = false,
    children,
}: CoverHeroProps) {
    const { cover } = layout;

    return (
        <View className="justify-end" style={{ height: layout.height }}>
            <FadedArtwork
                uri={uri}
                placeholderUri={placeholderUri}
                fadeStart={layout.fadeStart}
                cover={cover}
                fallback={fallback}
            />
            {zoomTarget ? (
                // The real cover, not its mirror. Sized explicitly, since the
                // target wraps it in an unstyled native view that an absolute
                // fill would collapse to nothing.
                <View
                    pointerEvents="none"
                    style={{
                        position: "absolute",
                        left: cover.left,
                        top: cover.top,
                    }}
                >
                    <Link.AppleZoomTarget>
                        <View
                            collapsable={false}
                            style={{ width: cover.size, height: cover.size }}
                        />
                    </Link.AppleZoomTarget>
                </View>
            ) : null}
            {children}
        </View>
    );
}

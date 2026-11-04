import { Link } from "expo-router";
import { useMemo, type ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    FadedArtwork,
    type CoverFrame,
} from "@/components/custom/faded-artwork";

/**
 * Apple's album page, measured on a 393pt phone: the cover is 1.05 screen
 * widths and centered, so a few points crop off each side. Its top sits 32pt
 * under the status bar, its top edge stretched up to fill the room, and its
 * bottom edge stretched down past it, fading out from the cover's bottom into
 * the page. The title ends 40pt below the cover.
 */
const COVER_SCALE = 1.05;
const COVER_TOP_GAP = 32;
/** How far below the cover's bottom the title block ends. */
const TITLE_DROP = 40;
/**
 * How far the cover's bottom edge runs past it before it is gone, about where
 * the actions row under the title ends.
 */
const COVER_BOTTOM_ROOM = 110;

export type CoverHeroLayout = {
    /** Where the cover itself sits inside the hero. */
    cover: CoverFrame;
    /**
     * The artwork's height: the room above the cover, the cover, and the room
     * below it. Taller than `height`, so it runs on under what follows.
     */
    artworkHeight: number;
    /** Fraction of `artworkHeight` where the fade starts. */
    fadeStart: number;
    /** The hero's full height: the artwork plus the title's drop below it. */
    height: number;
};

/** The hero's geometry for a screen `width` wide under a `safeTop` inset. */
export function coverHeroLayout(
    width: number,
    safeTop: number,
): CoverHeroLayout {
    const size = width * COVER_SCALE;
    const top = safeTop + COVER_TOP_GAP;
    return {
        cover: {
            left: (width - size) / 2,
            top,
            size,
            below: COVER_BOTTOM_ROOM,
        },
        artworkHeight: top + size + COVER_BOTTOM_ROOM,
        // all of the cover shows; only what is stretched past it fades
        fadeStart: (top + size) / (top + size + COVER_BOTTOM_ROOM),
        height: top + size + TITLE_DROP,
    };
}

/**
 * `coverHeroLayout` for this window and its safe area. The same object until
 * either changes, so the memoized artwork does not re-render with the page.
 */
export function useCoverHeroLayout() {
    const { width } = useWindowDimensions();
    const { top } = useSafeAreaInsets();
    return useMemo(() => coverHeroLayout(width, top), [width, top]);
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
 * A square cover run past both edges, its top edge stretched up under the
 * status bar and blurring as it goes, fading into the page at the bottom,
 * with `children` over the fade. For the album,
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
            <View
                pointerEvents="none"
                style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    height: layout.artworkHeight,
                }}
            >
                <FadedArtwork
                    uri={uri}
                    placeholderUri={placeholderUri}
                    fadeStart={layout.fadeStart}
                    cover={cover}
                    // only drawn without a uri, and a new element each render
                    // would re-render the artwork for nothing
                    fallback={uri ? null : fallback}
                />
            </View>
            {zoomTarget ? (
                // The real cover, not its blurred copy. Sized explicitly, since the
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

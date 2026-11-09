import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Platform, View } from "react-native";
import Animated, {
    useScrollOffset,
    useSharedValue,
    type AnimatedRef,
    type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { NebulaBackdrop } from "@/components/ui/nebula-backdrop";
import { ScrollEdgeBlur } from "@/components/ui/scroll-edge-blur";
import { Text } from "@/components/ui/text";
import { useArtworkNebulaColors } from "@/lib/artwork-color";
import { InsideSheetContext } from "@/lib/screen-overlay";

/**
 * How the route this shell fills is presented. A sheet is a native surface over
 * the whole app; a screen is pushed inside a tab, under the tab bar and the
 * player. The two differ in what they owe the top and bottom edges,
 * and in nothing else.
 */
export type DetailPresentation = "screen" | "sheet";

/** The header row under the top inset. Matches its `h-16`. */
const HEADER_ROW_HEIGHT = 64;

/**
 * What a body that scrolls under the header needs: the room to leave at the
 * top, and the offset the header's blur follows.
 */
type HeaderScroll = { inset: number; scrollOffset: SharedValue<number> };

const HeaderScrollContext = createContext<HeaderScroll | null>(null);

/**
 * Wires a scroll view into a `DetailScreen` with `scrollsUnderHeader`. Pass
 * the scroll view's animated ref and pad its content top by the returned
 * inset. Outside one, the inset is 0 and nothing is wired.
 */
export function useDetailHeaderScroll(
    ref: AnimatedRef<Animated.ScrollView>,
): number {
    const header = useContext(HeaderScrollContext);
    useScrollOffset(ref, header?.scrollOffset);
    return header?.inset ?? 0;
}

type DetailScreenProps = {
    title: string;
    /** Defaults to going back, for the X on a sheet or the back on a screen. */
    onClose?: () => void;
    /** Extra controls on the right of the header. */
    headerRight?: ReactNode;
    /**
     * Artwork the nebula behind the screen is colored from, the small copy.
     * With neither this nor `tint`, the screen is the flat card color.
     */
    artworkUrl?: string | null;
    /** The nebula's color without artwork, and while its colors load. */
    tint?: string | null;
    /**
     * Set colors for the nebula, for a screen with no artwork that still has
     * a color of its own, like the Apple Music sheets. Wins over the other two.
     */
    nebulaColors?: readonly string[];
    /** Defaults to a pushed screen. Account, Appearance, and Player are sheets. */
    presentation?: DetailPresentation;
    /**
     * The body runs to the top edge and scrolls under the header, which blurs
     * what passes beneath it. The body's scroll view uses
     * `useDetailHeaderScroll`. Off, the body starts below the header.
     */
    scrollsUnderHeader?: boolean;
    children: ReactNode;
};

/**
 * The header and safe-area shell for a detail route: the title, a back button
 * on a pushed screen or a close button on a sheet, and the body below them. The caller decides whether the body scrolls and owns
 * its own bottom inset.
 *
 * What changes between the two is the top inset, since a sheet already starts
 * below the status bar, and whether the body counts the bottom bars: a sheet
 * covers them, a pushed screen has them over it.
 *
 * The body sits in its own clipped flex box and the header is lifted above it.
 * Sibling order alone would let a body that mis-sizes itself paint over the
 * header and swallow the close button, which is exactly what a content-sized
 * list inside a sheet does while the sheet animates.
 */
export function DetailScreen({
    title,
    onClose,
    headerRight,
    artworkUrl = null,
    tint = null,
    nebulaColors,
    presentation = "screen",
    scrollsUnderHeader = false,
    children,
}: DetailScreenProps) {
    const isSheet = presentation === "sheet";
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();

    return (
        <DetailScreenBody
            title={title}
            onClose={onClose}
            headerRight={headerRight}
            artworkUrl={artworkUrl}
            tint={tint}
            nebulaColors={nebulaColors}
            isSheet={isSheet}
            scrollsUnderHeader={scrollsUnderHeader}
            // a sheet starts below the status bar, so on iOS that is just room
            // for the native grabber
            insetTop={isSheet && Platform.OS === "ios" ? 12 : insets.top}
            textColor={String(colors.text)}
        >
            {children}
        </DetailScreenBody>
    );
}

/** The header, the nebula, and the body. */
function DetailScreenBody({
    title,
    onClose,
    headerRight,
    artworkUrl,
    tint,
    nebulaColors,
    isSheet,
    scrollsUnderHeader,
    insetTop,
    textColor,
    children,
}: {
    title: string;
    onClose?: () => void;
    headerRight?: ReactNode;
    artworkUrl: string | null;
    tint: string | null;
    nebulaColors?: readonly string[];
    isSheet: boolean;
    scrollsUnderHeader: boolean;
    insetTop: number;
    textColor: string;
    children: ReactNode;
}) {
    const router = useRouter();
    const close = onClose ?? (() => router.back());
    const nebulaUrls = useMemo(
        () => (artworkUrl ? [artworkUrl] : []),
        [artworkUrl],
    );
    const artworkNebula = useArtworkNebulaColors(nebulaUrls, tint);
    const nebula = nebulaColors ?? artworkNebula;
    const foreground = textColor;
    const headerHeight = insetTop + HEADER_ROW_HEIGHT;
    const scrollOffset = useSharedValue(0);
    const headerScroll = useMemo(
        () => ({ inset: headerHeight, scrollOffset }),
        [headerHeight, scrollOffset],
    );

    return (
        <View
            className={
                nebula.length > 0 ? "flex-1 bg-background" : "flex-1 bg-card"
            }
        >
            {/* Behind the header as well as the body, so the color runs to the
                top edge of the sheet rather than starting under the title. */}
            <NebulaBackdrop colors={nebula} layout="full" />

            <View
                style={{
                    // over the body when it scrolls underneath
                    ...(scrollsUnderHeader
                        ? { position: "absolute", top: 0, left: 0, right: 0 }
                        : null),
                    // A sheet already starts below the status bar, so on iOS
                    // that is just room for the native grabber. A pushed screen
                    // pays the whole inset, because it starts at the top edge.
                    paddingTop: insetTop,
                    // Paints and hit-tests above the body no matter what the
                    // body does with its own height.
                    zIndex: 1,
                    elevation: 1,
                }}
            >
                {scrollsUnderHeader ? (
                    <ScrollEdgeBlur
                        height={headerHeight}
                        scrollOffset={scrollOffset}
                    />
                ) : null}
                <View className="h-16 flex-row items-center justify-between gap-3 px-5">
                    {isSheet ? null : (
                        <GlassIconButton
                            bordered={false}
                            accessibilityLabel="Back"
                            onPress={close}
                        >
                            <Ionicons
                                name="chevron-back"
                                size={22}
                                color={foreground}
                            />
                        </GlassIconButton>
                    )}
                    <Text
                        className="flex-1 text-3xl font-bold tracking-tight"
                        style={{ color: foreground }}
                        numberOfLines={1}
                    >
                        {title}
                    </Text>
                    <View className="flex-row items-center gap-2">
                        {headerRight}
                        {isSheet ? (
                            <GlassIconButton
                                bordered={false}
                                accessibilityLabel={`Close ${title.toLowerCase()}`}
                                onPress={close}
                            >
                                <Ionicons
                                    name="close"
                                    size={22}
                                    color={foreground}
                                />
                            </GlassIconButton>
                        ) : null}
                    </View>
                </View>
            </View>

            {/* Inside a sheet, overlay insets stop counting the tab bar and
                the compact player: neither renders over it. A pushed screen
                has them over its content and pads for them. */}
            <InsideSheetContext.Provider value={isSheet}>
                <HeaderScrollContext.Provider
                    value={scrollsUnderHeader ? headerScroll : null}
                >
                    <View className="flex-1 overflow-hidden">{children}</View>
                </HeaderScrollContext.Provider>
            </InsideSheetContext.Provider>
        </View>
    );
}

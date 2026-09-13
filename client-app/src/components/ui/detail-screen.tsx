import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import type { ReactNode } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
import { TintBackdrop } from "@/components/ui/tint-backdrop";
import { InsideSheetContext } from "@/lib/screen-overlay";
import { useCloseScreen, ZoomDismissScreen } from "@/lib/zoom-dismiss";

/**
 * How the route this shell fills is presented. A sheet is a native surface over
 * the whole app; a screen is pushed in the root stack with the bottom bars
 * floating over it. The two differ in what they owe the top and bottom edges,
 * and in nothing else.
 */
export type DetailPresentation = "screen" | "sheet";

type DetailScreenProps = {
    title: string;
    /** Defaults to closing the screen, which is what the X is for. */
    onClose?: () => void;
    /** Extra controls placed left of the close button. */
    headerRight?: ReactNode;
    /**
     * Artwork color to wash the sheet with, from `useArtworkTint`. Null leaves
     * it the flat card color.
     */
    tint?: string | null;
    /** Defaults to a pushed screen. Only `/account` and `/player` are sheets. */
    presentation?: DetailPresentation;
    children: ReactNode;
};

/**
 * The header and safe-area shell for a detail route: the title, a close button,
 * and the body below them. The caller decides whether the body scrolls and owns
 * its own bottom inset.
 *
 * Both presentations get the same header, so closing out of one reads the same
 * as closing out of the other. What changes is the top inset, since a sheet
 * already starts below the status bar, and whether the body counts the bottom
 * bars: a sheet covers them, a pushed screen has them floating over it.
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
    tint = null,
    presentation = "screen",
    children,
}: DetailScreenProps) {
    const isSheet = presentation === "sheet";
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();

    // A sheet already has a native dismiss, and wrapping it would minimize a
    // card inside a card. Only a pushed screen gets the zoom.
    if (isSheet) {
        return (
            <DetailScreenBody
                title={title}
                onClose={onClose}
                headerRight={headerRight}
                tint={tint}
                isSheet
                insetTop={Platform.OS === "ios" ? 12 : insets.top}
                textColor={String(colors.text)}
            >
                {children}
            </DetailScreenBody>
        );
    }

    return (
        <ZoomDismissScreen>
            <DetailScreenBody
                title={title}
                onClose={onClose}
                headerRight={headerRight}
                tint={tint}
                isSheet={false}
                insetTop={insets.top}
                textColor={String(colors.text)}
            >
                {children}
            </DetailScreenBody>
        </ZoomDismissScreen>
    );
}

/** The header, the tint, and the body. Identical either side of the wrapper. */
function DetailScreenBody({
    title,
    onClose,
    headerRight,
    tint,
    isSheet,
    insetTop,
    textColor,
    children,
}: {
    title: string;
    onClose?: () => void;
    headerRight?: ReactNode;
    tint: string | null;
    isSheet: boolean;
    insetTop: number;
    textColor: string;
    children: ReactNode;
}) {
    const close = useCloseScreen();

    return (
        <View className="flex-1 bg-card">
            {/* Behind the header as well as the body, so the color runs to the
                top edge of the sheet rather than starting under the title. */}
            <TintBackdrop tint={tint} />

            <View
                style={{
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
                <View className="h-16 flex-row items-center justify-between px-5">
                    <Text
                        className="flex-1 text-3xl font-bold tracking-tight"
                        numberOfLines={1}
                    >
                        {title}
                    </Text>
                    <View className="flex-row items-center gap-2">
                        {headerRight}
                        <GlassIconButton
                            accessibilityLabel={`Close ${title.toLowerCase()}`}
                            onPress={onClose ?? close}
                        >
                            <Ionicons
                                name="close"
                                size={22}
                                color={textColor}
                            />
                        </GlassIconButton>
                    </View>
                </View>
            </View>

            {/* Inside a sheet, overlay insets stop counting the tab bar and
                the compact player: both are behind it rather than over it. A
                pushed screen has them over its content and pads for them. */}
            <InsideSheetContext.Provider value={isSheet}>
                <View className="flex-1 overflow-hidden">{children}</View>
            </InsideSheetContext.Provider>
        </View>
    );
}

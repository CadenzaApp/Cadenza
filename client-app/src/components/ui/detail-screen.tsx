import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useMemo, type ReactNode } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { NebulaBackdrop } from "@/components/ui/nebula-backdrop";
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
    /** Defaults to a pushed screen. Account, Appearance, and Player are sheets. */
    presentation?: DetailPresentation;
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
    presentation = "screen",
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
            isSheet={isSheet}
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
    isSheet,
    insetTop,
    textColor,
    children,
}: {
    title: string;
    onClose?: () => void;
    headerRight?: ReactNode;
    artworkUrl: string | null;
    tint: string | null;
    isSheet: boolean;
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
    const nebula = useArtworkNebulaColors(nebulaUrls, tint);
    const foreground = textColor;

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
                <View className="flex-1 overflow-hidden">{children}</View>
            </InsideSheetContext.Provider>
        </View>
    );
}

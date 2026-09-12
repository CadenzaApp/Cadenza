import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import type { ReactNode } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
import { InsideSheetContext } from "@/lib/screen-overlay";

type SheetScreenProps = {
    title: string;
    /** Defaults to going back, which is what dismissing the sheet does. */
    onClose?: () => void;
    /** Extra controls placed left of the close button. */
    headerRight?: ReactNode;
    children: ReactNode;
};

/**
 * The header and safe-area shell for a route presented with
 * `sheetScreenOptions`. Renders the title, a close button, and the body below
 * it. The caller decides whether the body scrolls and owns its own bottom
 * inset.
 *
 * The body sits in its own clipped flex box and the header is lifted above it.
 * Sibling order alone would let a body that mis-sizes itself paint over the
 * header and swallow the close button, which is exactly what a content-sized
 * list inside a sheet does while the sheet animates.
 */
export function SheetScreen({
    title,
    onClose,
    headerRight,
    children,
}: SheetScreenProps) {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();

    return (
        <View className="flex-1 bg-card">
            <View
                className="bg-card"
                style={{
                    // The sheet already starts below the status bar, so on iOS
                    // this is just room for the native grabber.
                    paddingTop: Platform.OS === "ios" ? 12 : insets.top,
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
                            onPress={onClose ?? (() => router.back())}
                        >
                            <Ionicons
                                name="close"
                                size={22}
                                color={colors.text}
                            />
                        </GlassIconButton>
                    </View>
                </View>
            </View>

            {/* Everything below here is inside a sheet, so overlay insets
                stop counting the tab bar and the compact player. */}
            <InsideSheetContext.Provider value={true}>
                <View className="flex-1 overflow-hidden">{children}</View>
            </InsideSheetContext.Provider>
        </View>
    );
}

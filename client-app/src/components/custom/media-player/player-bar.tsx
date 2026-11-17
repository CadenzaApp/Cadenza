import Ionicons from "@expo/vector-icons/Ionicons";
import { SymbolView, type SFSymbol } from "expo-symbols";
import type { ReactNode } from "react";
import {
    Platform,
    Pressable,
    StyleSheet,
    useWindowDimensions,
    View,
    type LayoutChangeEvent,
} from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { IoniconName } from "@/components/ui/ionicon-name";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

// iOS 26's floating tab bar metrics, so this bar matches the app's native one.
export const PLAYER_BAR_HEIGHT = 62;
export const PLAYER_BAR_RADIUS = PLAYER_BAR_HEIGHT / 2;
/** From the glass edge to the selection pill and the buttons. */
export const PLAYER_BAR_INSET = 2;
/** From the screen's sides, and its bottom on iOS. */
const BAR_MARGIN = 21;
/** Room per button in a bar sized to its buttons. */
const PLAYER_BAR_ITEM_WIDTH = 98;
/**
 * The point size SF Symbols are drawn at, medium weight, large scale. Matched
 * by eye to the native tab bar's icons. Drawn at that size, never stretched to
 * a box, so every glyph keeps its own proportions like UIKit's do. Needs the
 * `pointSize` prop from `patches/expo-symbols`.
 */
const ICON_POINT_SIZE = 22;
/** Height of the icon row. Twice as wide, so no glyph is clipped. */
const ICON_BOX = 30;
const RESIZE = LinearTransition.duration(220);

/**
 * The glass bar at the bottom of the now playing sheet: the page tabs, or in
 * a live session the session's buttons. With `itemCount` it is only as wide as
 * that many buttons need, up to the full bar, and grows or shrinks as the
 * count changes, like a live session's buttons as a role changes.
 */
export function PlayerBarShell({
    children,
    onLayout,
    itemCount,
}: {
    children: ReactNode;
    onLayout?: (event: LayoutChangeEvent) => void;
    itemCount?: number;
}) {
    const insets = useSafeAreaInsets();
    const { width: screenWidth } = useWindowDimensions();
    const fullWidth = screenWidth - BAR_MARGIN * 2;
    const width =
        itemCount === undefined
            ? fullWidth
            : Math.min(
                  fullWidth,
                  itemCount * PLAYER_BAR_ITEM_WIDTH + PLAYER_BAR_INSET * 2,
              );
    return (
        <View
            className="items-center pt-2"
            style={{
                paddingBottom:
                    Platform.OS === "ios"
                        ? BAR_MARGIN
                        : Math.max(insets.bottom, 8),
            }}
        >
            <Animated.View
                layout={RESIZE}
                className="relative flex-row overflow-hidden"
                style={{
                    width,
                    height: PLAYER_BAR_HEIGHT,
                    padding: PLAYER_BAR_INSET,
                    borderRadius: PLAYER_BAR_RADIUS,
                    borderCurve: "continuous",
                }}
                onLayout={onLayout}
            >
                {/* The glass carries its own radius rather than leaning on
                the parent's clip. Native glass shapes its lensing and its
                specular edge from its own corners, so a clipped square reads
                as a flat fill instead of glass. Keep it off the touch path;
                the native view ignores `pointerEvents` and swallows the
                presses. */}
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <GlassSurface
                        style={[
                            StyleSheet.absoluteFill,
                            {
                                borderRadius: PLAYER_BAR_RADIUS,
                                borderCurve: "continuous",
                            },
                        ]}
                    />
                </View>
                {children}
            </Animated.View>
        </View>
    );
}

/**
 * One icon and label in the bar. An SF Symbol on iOS, the Ionicon elsewhere.
 * A tab (`selected` set) takes the accent when selected and the muted color
 * otherwise, like the native tab bar. A plain button stays the text color.
 */
export function PlayerBarButton({
    sf,
    icon,
    label,
    accessibilityLabel,
    role = "button",
    selected,
    badge,
    onPress,
}: {
    sf: SFSymbol;
    icon: IoniconName;
    label: string;
    accessibilityLabel?: string;
    role?: "button" | "tab";
    selected?: boolean;
    /** A count shown on the icon, hidden at 0. */
    badge?: number;
    onPress: () => void;
}) {
    const { brand, foreground, mutedForeground } = useAppTheme().colors;
    const color =
        selected === undefined
            ? foreground
            : selected
              ? brand
              : mutedForeground;
    const fallback = <Ionicons name={icon} size={22} color={color} />;
    return (
        <Pressable
            accessibilityRole={role}
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityState={
                selected === undefined ? undefined : { selected }
            }
            onPress={onPress}
            className={cn(
                "flex-1 items-center justify-center",
                role === "button" && "active:opacity-70",
            )}
        >
            <View
                className="items-center justify-center"
                style={{ width: ICON_BOX * 2, height: ICON_BOX }}
            >
                {Platform.OS === "ios" ? (
                    <SymbolView
                        name={sf}
                        pointSize={ICON_POINT_SIZE}
                        weight="medium"
                        scale="large"
                        resizeMode="center"
                        style={{ width: ICON_BOX * 2, height: ICON_BOX }}
                        tintColor={color}
                        fallback={fallback}
                    />
                ) : (
                    fallback
                )}
                {badge ? (
                    <View
                        className="absolute -top-0.5 h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1"
                        // over the glyph's top right, from the row's center
                        style={{ left: ICON_BOX + 6 }}
                    >
                        <Text className="text-[10px] font-bold text-white">
                            {badge}
                        </Text>
                    </View>
                ) : null}
            </View>
            <Text
                className="text-[10px] font-semibold"
                style={{ color, marginTop: 1 }}
                numberOfLines={1}
            >
                {label}
            </Text>
        </Pressable>
    );
}

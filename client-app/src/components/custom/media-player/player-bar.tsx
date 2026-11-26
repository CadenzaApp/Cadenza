import MaskedView from "@react-native-masked-view/masked-view";
import Svg, { Path } from "react-native-svg";
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
import Animated, {
    LinearTransition,
    useAnimatedProps,
    useAnimatedStyle,
    useDerivedValue,
    type SharedValue,
} from "react-native-reanimated";
import { GestureDetector, type PanGesture } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { IoniconName } from "@/components/ui/ionicon-name";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

import { playerPillMask } from "./player-bar-drag";
import { PLAYER_TABS, type PlayerTab } from "./player-tabs";

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
    gesture,
}: {
    children: ReactNode;
    onLayout?: (event: LayoutChangeEvent) => void;
    itemCount?: number;
    gesture?: PanGesture;
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
    const bar = (
        <Animated.View
            collapsable={false}
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
            {gesture ? (
                <GestureDetector gesture={gesture}>{bar}</GestureDetector>
            ) : (
                bar
            )}
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
            <PlayerBarGlyph
                sf={sf}
                icon={icon}
                label={label}
                color={color}
                badge={badge}
            />
        </Pressable>
    );
}

/** Shared glyph layout for the masked tab bar and ordinary session buttons. */
function PlayerBarGlyph({
    sf,
    icon,
    label,
    color,
    badge,
}: {
    sf: SFSymbol;
    icon: IoniconName;
    label: string;
    color: string;
    badge?: number;
}) {
    const fallback = <Ionicons name={icon} size={22} color={color} />;
    return (
        <>
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
        </>
    );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const FILL = {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
} as const;
const TAB_PRESENTATION = {
    discuss: {
        label: "Discuss",
        sf: { active: "bubble.left.fill", inactive: "bubble.left" },
        icon: { active: "chatbubble", inactive: "chatbubble-outline" },
    },
    player: {
        label: "Player",
        sf: { active: "music.note", inactive: "music.note" },
        icon: { active: "musical-note", inactive: "musical-note-outline" },
    },
    tags: {
        label: "Tags",
        sf: { active: "tag.fill", inactive: "tag" },
        icon: { active: "pricetag", inactive: "pricetag-outline" },
    },
} as const satisfies Record<
    PlayerTab,
    {
        label: string;
        sf: Record<"active" | "inactive", SFSymbol>;
        icon: Record<"active" | "inactive", IoniconName>;
    }
>;

/** Complementary masks switch glyph form and color at the pill's exact edge. */
export function PlayerTabIcons(props: {
    barWidth: number;
    pageWidth: number;
    scrollX: SharedValue<number>;
    selectedTab: PlayerTab;
    onSelect: (tab: PlayerTab) => void;
}) {
    return (
        <MaskedTabIcons
            {...props}
            tabs={PLAYER_TABS}
            presentation={TAB_PRESENTATION}
        />
    );
}

export function MaskedTabIcons<T extends string>({
    tabs,
    presentation,
    inactiveColor,
    barWidth,
    pageWidth,
    scrollX,
    selectedTab,
    onSelect,
}: {
    barWidth: number;
    pageWidth: number;
    scrollX: SharedValue<number>;
    tabs: readonly T[];
    inactiveColor?: string;
    presentation: Record<
        T,
        {
            label: string;
            sf: Record<"active" | "inactive", SFSymbol>;
            icon: Record<"active" | "inactive", IoniconName>;
        }
    >;
    selectedTab: T;
    onSelect: (tab: T) => void;
}) {
    const { colors, scheme } = useAppTheme();
    const width = Math.max(0, barWidth - 2 * PLAYER_BAR_INSET);
    const height = PLAYER_BAR_HEIGHT - 2 * PLAYER_BAR_INSET;
    const geometry = useDerivedValue(() =>
        playerPillMask(
            pageWidth > 0 ? scrollX.get() / pageWidth : 0,
            width,
            height,
            tabs.length,
        ),
    );
    const insideProps = useAnimatedProps(() => ({ d: geometry.get().inside }));
    const outsideProps = useAnimatedProps(() => ({
        d: geometry.get().outside,
    }));
    const pillStyle = useAnimatedStyle(() => ({
        width: geometry.get().width,
        transform: [{ translateX: geometry.get().left }],
    }));
    return (
        <View className="flex-1">
            <Animated.View
                pointerEvents="none"
                className="absolute bottom-0 left-0 top-0"
                style={[
                    {
                        borderRadius: PLAYER_BAR_RADIUS - PLAYER_BAR_INSET,
                        backgroundColor:
                            scheme === "dark"
                                ? "rgba(0, 0, 0, 0.35)"
                                : "rgba(0, 0, 0, 0.08)",
                    },
                    pillStyle,
                ]}
            />
            {([false, true] as const).map((filled) => (
                <MaskedView
                    key={String(filled)}
                    pointerEvents="none"
                    accessible={false}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    androidRenderingMode="software"
                    style={FILL}
                    maskElement={
                        <Svg width={width} height={height}>
                            <AnimatedPath
                                fill="black"
                                fillRule="evenodd"
                                animatedProps={
                                    filled ? insideProps : outsideProps
                                }
                            />
                        </Svg>
                    }
                >
                    <View className="flex-1 flex-row">
                        {tabs.map((tab) => {
                            const look = presentation[tab];
                            return (
                                <View
                                    key={tab}
                                    className="flex-1 items-center justify-center"
                                >
                                    <PlayerBarGlyph
                                        sf={
                                            look.sf[
                                                filled ? "active" : "inactive"
                                            ]
                                        }
                                        icon={
                                            look.icon[
                                                filled ? "active" : "inactive"
                                            ]
                                        }
                                        label={look.label}
                                        color={
                                            filled
                                                ? colors.brand
                                                : (inactiveColor ??
                                                  colors.mutedForeground)
                                        }
                                    />
                                </View>
                            );
                        })}
                    </View>
                </MaskedView>
            ))}
            <View className="flex-1 flex-row">
                {tabs.map((tab) => (
                    <Pressable
                        key={tab}
                        className="flex-1"
                        accessibilityRole="tab"
                        accessibilityLabel={presentation[tab].label}
                        accessibilityState={{ selected: selectedTab === tab }}
                        onPress={() => onSelect(tab)}
                    />
                ))}
            </View>
        </View>
    );
}

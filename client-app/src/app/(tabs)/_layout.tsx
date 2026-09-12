import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Tabs } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, type PressableProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TopRail } from "@/components/custom/top-rail";
import { GlassSurface } from "@/components/ui/glass-surface";
import { useAccount } from "@/lib/account";
import { TAB_BAR_HEIGHT, TAB_BAR_MARGIN } from "@/lib/screen-overlay";

const TAB_BAR_RADIUS = TAB_BAR_HEIGHT / 2;
/**
 * How far below center the icon and label sit. Each item is an icon stacked
 * over a label, so its visual weight is above its geometric middle and true
 * center still reads high.
 */
const TAB_ITEM_NUDGE = 3;

/**
 * The bubble behind the selected tab. It hangs off the top of the item box
 * rather than filling it: the item packs its icon and label to the top, so a
 * centered bubble would sit low and swallow empty space under the label.
 */
const TAB_PILL_INSET_X = 6;
const TAB_PILL_HEIGHT = 46;
const TAB_PILL_RADIUS = 20;

type TabBarButtonProps = Omit<PressableProps, "children"> & {
    children?: ReactNode;
    "aria-selected"?: boolean;
};

/**
 * A tab item with a second piece of glass behind it while it is selected. The
 * navigator only hands the button `aria-selected`, so that is what drives it.
 */
function TabBarButton({ children, ...props }: TabBarButtonProps) {
    const focused = props["aria-selected"] === true;

    return (
        <Pressable {...props}>
            {focused ? (
                <GlassSurface
                    pointerEvents="none"
                    style={{
                        position: "absolute",
                        top: 0,
                        left: TAB_PILL_INSET_X,
                        right: TAB_PILL_INSET_X,
                        height: TAB_PILL_HEIGHT,
                        borderRadius: TAB_PILL_RADIUS,
                        borderCurve: "continuous",
                        overflow: "hidden",
                    }}
                />
            ) : null}
            {children}
        </Pressable>
    );
}

export default function TabLayout() {
    const { colors } = useTheme();
    const { account } = useAccount();
    const insets = useSafeAreaInsets();

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
    }

    return (
        <Tabs
            screenOptions={{
                tabBarActiveTintColor: colors.notification,
                tabBarInactiveTintColor: colors.text,
                // A screen contributes its own controls with
                // `navigation.setOptions({ headerRight })`, so the state behind
                // them stays in that screen rather than becoming shared.
                header: ({ options }) => (
                    <TopRail
                        title={
                            typeof options.title === "string"
                                ? options.title
                                : ""
                        }
                        actions={options.headerRight?.({ canGoBack: false })}
                    />
                ),
                // The bar floats over the content instead of sitting in the
                // layout, so screens owe themselves the padding from
                // `useScreenOverlayInsets`. The clip is on the background
                // rather than the container, because clipping would cut off
                // the container's shadow.
                tabBarBackground: () => (
                    <GlassSurface
                        style={[
                            StyleSheet.absoluteFill,
                            {
                                borderRadius: TAB_BAR_RADIUS,
                                overflow: "hidden",
                            },
                        ]}
                    />
                ),
                // The bar packs its items to the top edge by default, which
                // leaves the icons crowding it. Center them, then nudge.
                // A transform rather than padding, because the item carries
                // its own padding and the two would have to be kept in sync.
                // The navigator hands the button a few web and hover props a
                // plain Pressable has no use for. It ignores the extras.
                tabBarButton: (props) => (
                    <TabBarButton {...(props as TabBarButtonProps)} />
                ),
                tabBarItemStyle: {
                    justifyContent: "center",
                    transform: [{ translateY: TAB_ITEM_NUDGE }],
                },
                tabBarStyle: {
                    position: "absolute",
                    // The bar's own style sets `start`/`end` to 0, and those
                    // beat `left`/`right`. A margin is what actually insets it.
                    marginHorizontal: TAB_BAR_MARGIN,
                    bottom: insets.bottom,
                    height: TAB_BAR_HEIGHT,
                    // The bar adds the safe-area inset itself by default, which
                    // would double-count against `bottom`.
                    paddingBottom: 0,
                    backgroundColor: "transparent",
                    borderTopWidth: 0,
                    borderRadius: TAB_BAR_RADIUS,
                    elevation: 0,
                    shadowColor: "#000",
                    shadowOpacity: 0.18,
                    shadowRadius: 12,
                    shadowOffset: { width: 0, height: 4 },
                },
            }}
        >
            <Tabs.Screen
                name="social"
                options={{
                    title: "Social",
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons
                            name={focused ? "people-sharp" : "people-outline"}
                            color={color}
                            size={24}
                        />
                    ),
                }}
            />
            <Tabs.Screen
                name="analytics"
                options={{
                    title: "Analytics",
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons
                            name={
                                focused
                                    ? "stats-chart-sharp"
                                    : "stats-chart-outline"
                            }
                            color={color}
                            size={24}
                        />
                    ),
                }}
            />
            <Tabs.Screen
                name="cadenza"
                options={{
                    title: "Cadenza",
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons
                            name={
                                focused
                                    ? "musical-notes-sharp"
                                    : "musical-notes-outline"
                            }
                            color={color}
                            size={24}
                        />
                    ),
                }}
            />
            <Tabs.Screen
                name="library"
                options={{
                    title: "Library",
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons
                            name={focused ? "library-sharp" : "library-outline"}
                            color={color}
                            size={24}
                        />
                    ),
                }}
            />
            <Tabs.Screen
                name="search"
                options={{
                    title: "Search",
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons
                            name={focused ? "search-sharp" : "search-outline"}
                            color={color}
                            size={24}
                        />
                    ),
                }}
            />
        </Tabs>
    );
}

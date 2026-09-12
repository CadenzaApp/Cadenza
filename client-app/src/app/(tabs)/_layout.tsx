import { Redirect, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    TabBarGlass,
    TabBarIcon,
    TabBarLabel,
    TabSelectionProvider,
} from "@/components/custom/tab-bar";
import { TopRail } from "@/components/custom/top-rail";
import { useAccount } from "@/lib/account";
import { TAB_BAR_HEIGHT, TAB_BAR_MARGIN } from "@/lib/screen-overlay";

const TAB_BAR_RADIUS = TAB_BAR_HEIGHT / 2;
/**
 * How far below center the icon and label sit. Each item is an icon stacked
 * over a label, so its visual weight is above its geometric middle and true
 * center still reads high.
 */
const TAB_ITEM_NUDGE = 3;

export default function TabLayout() {
    const { account } = useAccount();
    const insets = useSafeAreaInsets();

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
    }

    return (
        <TabSelectionProvider>
            <Tabs
                screenOptions={{
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
                            actions={options.headerRight?.({
                                canGoBack: false,
                            })}
                        />
                    ),
                    // The bar floats over the content instead of sitting in the
                    // layout, so screens owe themselves the padding from
                    // `useScreenOverlayInsets`. Its glass and the bubble that
                    // slides between tabs both live in the background, which
                    // renders behind the items and clips without killing the
                    // container's shadow.
                    tabBarBackground: () => <TabBarGlass />,
                    // The bar packs its items to the top edge by default, which
                    // leaves the icons crowding it. Center them, then nudge.
                    // A transform rather than padding, because the item carries
                    // its own padding and the two would have to be kept in sync.
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
                        tabBarIcon: () => (
                            <TabBarIcon index={0} name="people" />
                        ),
                        tabBarLabel: () => (
                            <TabBarLabel index={0}>Social</TabBarLabel>
                        ),
                    }}
                />
                <Tabs.Screen
                    name="analytics"
                    options={{
                        title: "Analytics",
                        tabBarIcon: () => (
                            <TabBarIcon index={1} name="stats-chart" />
                        ),
                        tabBarLabel: () => (
                            <TabBarLabel index={1}>Analytics</TabBarLabel>
                        ),
                    }}
                />
                <Tabs.Screen
                    name="cadenza"
                    options={{
                        title: "Cadenza",
                        tabBarIcon: () => (
                            <TabBarIcon index={2} name="musical-notes" />
                        ),
                        tabBarLabel: () => (
                            <TabBarLabel index={2}>Cadenza</TabBarLabel>
                        ),
                    }}
                />
                <Tabs.Screen
                    name="library"
                    options={{
                        title: "Library",
                        tabBarIcon: () => (
                            <TabBarIcon index={3} name="library" />
                        ),
                        tabBarLabel: () => (
                            <TabBarLabel index={3}>Library</TabBarLabel>
                        ),
                    }}
                />
                <Tabs.Screen
                    name="search"
                    options={{
                        title: "Search",
                        tabBarIcon: () => (
                            <TabBarIcon index={4} name="search" />
                        ),
                        tabBarLabel: () => (
                            <TabBarLabel index={4}>Search</TabBarLabel>
                        ),
                    }}
                />
            </Tabs>
        </TabSelectionProvider>
    );
}

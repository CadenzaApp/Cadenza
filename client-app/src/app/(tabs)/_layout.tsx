import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Tabs } from "expo-router";
import { useTheme } from "expo-router/react-navigation";

import { TopRail } from "@/components/custom/top-rail";
import { useAccount } from "@/lib/account";

export default function TabLayout() {
    const { colors } = useTheme();
    const { account } = useAccount();

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
    }

    return (
        <Tabs
            screenOptions={{
                tabBarActiveTintColor: colors.notification,
                tabBarInactiveTintColor: colors.text,
                header: ({ options }) => (
                    <TopRail
                        title={
                            typeof options.title === "string"
                                ? options.title
                                : ""
                        }
                    />
                ),
                tabBarStyle: {
                    backgroundColor: colors.card,
                    borderTopColor: colors.border,
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

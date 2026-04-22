import { Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@react-navigation/native";

export default function TabLayout() {
    const { colors } = useTheme();

    return (
        <Tabs
                screenOptions={{
                    tabBarActiveTintColor: colors.primary,
                    tabBarInactiveTintColor: colors.text,
                    headerStyle: {
                        backgroundColor: colors.card,
                    },
                    headerShadowVisible: false,
                    headerTintColor: colors.text,
                    tabBarStyle: {
                        backgroundColor: colors.card,
                        borderTopColor: colors.border,
                    },
                }}
            >
                <Tabs.Screen
                    name="home"
                    options={{
                        title: "Home",
                        tabBarIcon: ({ color, focused }) => (
                            <Ionicons
                                name={focused ? "home-sharp" : "home-outline"}
                                color={color}
                                size={24}
                            />
                        ),
                    }}
                />
                <Tabs.Screen
                    name="tags"
                    options={{
                        title: "Tags",
                        tabBarIcon: ({ color, focused }) => (
                            <Ionicons
                                name={
                                    focused
                                        ? "pricetags-sharp"
                                        : "pricetags-outline"
                                }
                                color={color}
                                size={24}
                            />
                        ),
                    }}
                />
                <Tabs.Screen
                    name="query"
                    options={{
                        title: "Query",
                        tabBarIcon: ({ color, focused }) => (
                            <Ionicons
                                name={
                                    focused
                                        ? "add-circle-sharp"
                                        : "add-circle-outline"
                                }
                                color={color}
                                size={24}
                            />
                        ),
                    }}
                />
                <Tabs.Screen
                    name="explore"
                    options={{
                        title: "Explore",
                        tabBarIcon: ({ color, focused }) => (
                            <Ionicons
                                name={
                                    focused
                                        ? "compass-sharp"
                                        : "compass-outline"
                                }
                                color={color}
                                size={24}
                            />
                        ),
                    }}
                />
                <Tabs.Screen
                    name="account"
                    options={{
                        title: "Account",
                        tabBarIcon: ({ color, focused }) => (
                            <Ionicons
                                name={
                                    focused ? "person-sharp" : "person-outline"
                                }
                                color={color}
                                size={24}
                            />
                        ),
                    }}
                />
        </Tabs>
    );
}

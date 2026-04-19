import { NAV_THEME } from "@/lib/theme";
import { ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import AccountProvider from "@/lib/account";
import { AppleMusicProvider } from "@/lib/apple-music";
import { PortalHost } from "@rn-primitives/portal";
import { useColorScheme } from "nativewind";

import "../../global.css";

export default function RootLayout() {
    const { colorScheme } = useColorScheme();

    return (
        <AccountProvider>
            <AppleMusicProvider>
                <ThemeProvider
                    value={
                        colorScheme === "dark"
                            ? NAV_THEME.dark
                            : NAV_THEME.light
                    }
                >
                    <Stack>
                        <Stack.Screen
                            name="(splashscreen)/index"
                            options={{ headerShown: false }}
                        />
                        <Stack.Screen
                            name="(tabs)"
                            options={{ headerShown: false }}
                        />
                        <Stack.Screen
                            name="auth/index"
                            options={{ title: "Welcome" }}
                        />
                    </Stack>
                </ThemeProvider>
                <PortalHost />
            </AppleMusicProvider>
        </AccountProvider>
    );
}

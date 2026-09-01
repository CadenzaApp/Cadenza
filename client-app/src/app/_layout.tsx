import { NAV_THEME } from "@/lib/theme";
import { ThemeProvider } from "expo-router/react-navigation";
import { Stack } from "expo-router";
import AccountProvider from "@/lib/account";
import { AppleMusicProvider } from "@/lib/apple-music";
import { PlaybackProvider } from "@/lib/playback";
import { MediaPlayerHost } from "@/components/custom/media-player";
import { TagsProvider } from "@/lib/tags";
import { PortalHost } from "@rn-primitives/portal";
import { useColorScheme } from "nativewind";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import "../../global.css";

export default function RootLayout() {
    const { colorScheme } = useColorScheme();

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <AccountProvider>
                <TagsProvider>
                    <AppleMusicProvider>
                        <PlaybackProvider>
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
                                    <Stack.Screen
                                        name="tag/[id]"
                                        options={{ headerShown: false }}
                                    />
                                </Stack>
                                <PortalHost />
                                <MediaPlayerHost />
                            </ThemeProvider>
                        </PlaybackProvider>
                    </AppleMusicProvider>
                </TagsProvider>
            </AccountProvider>
        </GestureHandlerRootView>
    );
}

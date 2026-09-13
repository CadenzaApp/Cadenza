import {
    NAV_THEME,
    pushedScreenOptions,
    sheetScreenOptions,
} from "@/lib/theme";
import { ThemeProvider } from "expo-router/react-navigation";
import { Stack } from "expo-router";
import AccountProvider from "@/lib/account";
import { AppleMusicProvider } from "@/lib/apple-music-auth";
import { PlaybackProvider } from "@/lib/playback";
import { MediaPlayerHost } from "@/components/custom/media-player";
import { TabBarHost, TabSelectionProvider } from "@/components/custom/tab-bar";
import { LibraryCategoriesProvider } from "@/features/library/library-categories";
import { PlayerDockProvider } from "@/lib/player-dock";
import { ZoomOriginProvider } from "@/lib/zoom-dismiss";
import { PortalHost } from "@rn-primitives/portal";
import { useColorScheme } from "nativewind";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import "../../global.css";

export default function RootLayout() {
    const { colorScheme } = useColorScheme();
    const theme = colorScheme === "dark" ? NAV_THEME.dark : NAV_THEME.light;

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <AccountProvider>
                <AppleMusicProvider>
                    <PlaybackProvider>
                        <ThemeProvider value={theme}>
                            <LibraryCategoriesProvider>
                                <PlayerDockProvider>
                                    <TabSelectionProvider>
                                        <ZoomOriginProvider>
                                            <Stack>
                                                <Stack.Screen
                                                    name="(splashscreen)/index"
                                                    options={{
                                                        headerShown: false,
                                                    }}
                                                />
                                                <Stack.Screen
                                                    name="(tabs)"
                                                    options={{
                                                        headerShown: false,
                                                    }}
                                                />
                                                <Stack.Screen
                                                    name="account"
                                                    options={sheetScreenOptions(
                                                        theme,
                                                    )}
                                                />
                                                <Stack.Screen
                                                    name="player"
                                                    options={sheetScreenOptions(
                                                        theme,
                                                    )}
                                                />
                                                <Stack.Screen
                                                    name="auth/index"
                                                    options={{
                                                        title: "Welcome",
                                                    }}
                                                />
                                                <Stack.Screen
                                                    name="library-categories"
                                                    options={pushedScreenOptions()}
                                                />
                                                <Stack.Screen
                                                    name="category/[kind]"
                                                    options={pushedScreenOptions()}
                                                />
                                                <Stack.Screen
                                                    name="collection/[kind]/[id]"
                                                    options={pushedScreenOptions()}
                                                />
                                                <Stack.Screen
                                                    name="tag/[tagId]"
                                                    options={pushedScreenOptions()}
                                                />
                                                <Stack.Screen
                                                    name="artist/[id]"
                                                    options={pushedScreenOptions()}
                                                />
                                                <Stack.Screen
                                                    name="add-to-playlist"
                                                    options={pushedScreenOptions()}
                                                />
                                            </Stack>
                                            <PortalHost />
                                            <TabBarHost />
                                            <MediaPlayerHost />
                                        </ZoomOriginProvider>
                                    </TabSelectionProvider>
                                </PlayerDockProvider>
                            </LibraryCategoriesProvider>
                        </ThemeProvider>
                    </PlaybackProvider>
                </AppleMusicProvider>
            </AccountProvider>
        </GestureHandlerRootView>
    );
}

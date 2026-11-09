import { AppThemeProvider, sheetScreenOptions } from "@/lib/theme";
import { useTheme } from "expo-router/react-navigation";
import { Stack } from "expo-router";
import AccountProvider from "@/lib/account";
import { AppleMusicProvider } from "@/lib/apple-music-auth";
import { SongInitProvider } from "@/lib/song-init";
import { ListeningEventProvider } from "@/lib/listening-events";
import { PlaybackProvider } from "@/lib/playback";
import { TasksHost, TasksProvider } from "@/components/custom/tasks";
import { AppleMusicSessionGuard } from "@/features/account/apple-music-session-guard";
import { LibraryCategoriesProvider } from "@/features/library/library-categories";
import { BottomBarVisibilityProvider } from "@/lib/screen-overlay";
import { PortalHost } from "@rn-primitives/portal";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { MusicListPreferencesProvider } from "@/lib/music-list-preferences";
import { UserSettingsProvider } from "@/lib/routes/settings";
import { InterestPlayTracker } from "@/lib/interest-play-tracker";
import { InterestDecay } from "@/lib/interest-decay";

import "../../global.css";

export default function RootLayout() {
    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <AccountProvider>
                <UserSettingsProvider>
                    <AppleMusicProvider>
                        <TasksProvider>
                            <SongInitProvider>
                                <ListeningEventProvider>
                                    <PlaybackProvider>
                                        <AppThemeProvider>
                                            <MusicListPreferencesProvider>
                                                <BottomBarVisibilityProvider>
                                                    <LibraryCategoriesProvider>
                                                        <RootStack />
                                                        <AppleMusicSessionGuard />
                                                        <InterestPlayTracker />
                                                        <InterestDecay />
                                                        <TasksHost />
                                                        <PortalHost />
                                                    </LibraryCategoriesProvider>
                                                </BottomBarVisibilityProvider>
                                            </MusicListPreferencesProvider>
                                        </AppThemeProvider>
                                    </PlaybackProvider>
                                </ListeningEventProvider>
                            </SongInitProvider>
                        </TasksProvider>
                    </AppleMusicProvider>
                </UserSettingsProvider>
            </AccountProvider>
        </GestureHandlerRootView>
    );
}

/** Every root route and how it is presented. Reads the theme the provider set. */
function RootStack() {
    const theme = useTheme();

    return (
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
            <Stack.Screen name="account" options={sheetScreenOptions(theme)} />
            <Stack.Screen
                name="appearance"
                options={sheetScreenOptions(theme)}
            />
            <Stack.Screen
                name="apple-music"
                options={sheetScreenOptions(theme)}
            />
            <Stack.Screen
                name="listening-preferences"
                options={sheetScreenOptions(theme)}
            />
            <Stack.Screen name="privacy" options={sheetScreenOptions(theme)} />
            <Stack.Screen
                name="account-details"
                options={sheetScreenOptions(theme)}
            />
            <Stack.Screen
                name="your-data"
                options={sheetScreenOptions(theme)}
            />
            <Stack.Screen
                name="apple-music-limits"
                options={sheetScreenOptions(theme)}
            />
            <Stack.Screen name="player" options={sheetScreenOptions(theme)} />
            <Stack.Screen
                name="auth/index"
                options={{ headerShown: false, animation: "fade" }}
            />
            <Stack.Screen
                name="auth/apple-music"
                options={{ headerShown: false, gestureEnabled: false }}
            />
            <Stack.Screen
                name="reconnect-apple-music"
                options={{ headerShown: false, presentation: "modal" }}
            />
            <Stack.Screen
                name="library-categories"
                options={sheetScreenOptions(theme)}
            />
            <Stack.Screen
                name="add-to-playlist"
                options={sheetScreenOptions(theme)}
            />
        </Stack>
    );
}

import {
    AppThemeProvider,
    pushedScreenOptions,
    sheetScreenOptions,
} from "@/lib/theme";
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
import { ZoomOriginProvider } from "@/lib/zoom-dismiss";
import { PortalHost } from "@rn-primitives/portal";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { MediaPlayerPushedScreenOverlay } from "@/components/custom/media-player";
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
                                                        <ZoomOriginProvider>
                                                            <RootStack />
                                                            <AppleMusicSessionGuard />
                                                            <MediaPlayerPushedScreenOverlay />
                                                            <InterestPlayTracker />
                                                            <InterestDecay />
                                                            <TasksHost />
                                                            <PortalHost />
                                                        </ZoomOriginProvider>
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
            <Stack.Screen name="player" options={sheetScreenOptions(theme)} />
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
                name="discuss/[songId]"
                options={pushedScreenOptions()}
            />
            <Stack.Screen
                name="query-results"
                options={{
                    headerShown: false,
                    contentStyle: {
                        backgroundColor: theme.colors.background,
                    },
                }}
            />
            <Stack.Screen name="tag/[tagId]" options={pushedScreenOptions()} />
            <Stack.Screen name="artist/[id]" options={pushedScreenOptions()} />
            <Stack.Screen
                name="add-to-playlist"
                options={pushedScreenOptions()}
            />
        </Stack>
    );
}

import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useTheme } from "expo-router/react-navigation";
import { useState } from "react";
import { DynamicColorIOS, Platform, View } from "react-native";

import {
    MediaPlayerAccessory,
    MediaPlayerFallbackOverlay,
    useMediaPlayerAccessoryDeclared,
} from "@/components/custom/media-player";
import { useAccount } from "@/lib/account";
import { usePlaybackTrackState } from "@/lib/playback";
import { useBottomBarsHidden } from "@/lib/screen-overlay";
import { THEME } from "@/lib/theme";

const IOS_TAB_COLOR =
    Platform.OS === "ios"
        ? DynamicColorIOS({
              light: THEME.light.foreground,
              dark: THEME.dark.foreground,
          })
        : THEME.light.foreground;
const IOS_UNSELECTED_TAB_COLOR =
    Platform.OS === "ios"
        ? DynamicColorIOS({
              light: THEME.light.mutedForeground,
              dark: THEME.dark.mutedForeground,
          })
        : THEME.light.mutedForeground;

/**
 * The five primary routes, rendered by the platform's native tab controller.
 * On iOS 26 the mini player is the controller's bottom accessory, so UIKit
 * moves it inline when the tab bar minimizes.
 */
export default function TabLayout() {
    const { account } = useAccount();
    const { isPlayerDismissed } = usePlaybackTrackState();
    const { colors } = useTheme();
    const hidden = useBottomBarsHidden();
    const accessoryDeclared = useMediaPlayerAccessoryDeclared();
    const [failedArtworkUrl, setFailedArtworkUrl] = useState<string | null>(
        null,
    );
    const selectedColor = Platform.OS === "ios" ? IOS_TAB_COLOR : colors.text;
    const unselectedColor =
        Platform.OS === "ios" ? IOS_UNSELECTED_TAB_COLOR : colors.text;

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
    }

    return (
        <View className="flex-1">
            <NativeTabs
                // Minimizing only buys something when there is a player to
                // minimize around. With no accessory the shrunk bar is just
                // the selected tab and Search with a hole between them, so
                // the full bar stays put instead.
                minimizeBehavior={accessoryDeclared ? "onScrollDown" : "never"}
                hidden={hidden}
                tintColor={selectedColor}
                iconColor={{
                    default: unselectedColor,
                    selected: selectedColor,
                }}
                labelStyle={{
                    default: { color: unselectedColor },
                    selected: { color: selectedColor },
                }}
                backgroundColor={colors.card}
                blurEffect="systemMaterial"
                disableTransparentOnScrollEdge
                indicatorColor={colors.border}
                tabBarRespectsIMEInsets
                unstable_nativeProps={{
                    ios: {
                        bottomAccessoryHidden: hidden || isPlayerDismissed,
                    },
                }}
            >
                {accessoryDeclared ? (
                    <NativeTabs.BottomAccessory>
                        <MediaPlayerAccessory
                            failedArtworkUrl={failedArtworkUrl}
                            onArtworkError={setFailedArtworkUrl}
                        />
                    </NativeTabs.BottomAccessory>
                ) : null}

                <NativeTabs.Trigger name="social">
                    <NativeTabs.Trigger.Icon
                        sf={{
                            default: "person.2",
                            selected: "person.2.fill",
                        }}
                        md={{ default: "people", selected: "people" }}
                    />
                    <NativeTabs.Trigger.Label>Social</NativeTabs.Trigger.Label>
                </NativeTabs.Trigger>

                <NativeTabs.Trigger name="analytics">
                    <NativeTabs.Trigger.Icon
                        sf={{
                            default: "chart.bar",
                            selected: "chart.bar.fill",
                        }}
                        md={{ default: "bar_chart", selected: "bar_chart" }}
                    />
                    <NativeTabs.Trigger.Label>
                        Analytics
                    </NativeTabs.Trigger.Label>
                </NativeTabs.Trigger>

                <NativeTabs.Trigger name="cadenza">
                    <NativeTabs.Trigger.Icon
                        sf="music.note.list"
                        md={{
                            default: "music_note",
                            selected: "music_note",
                        }}
                    />
                    <NativeTabs.Trigger.Label>Cadenza</NativeTabs.Trigger.Label>
                </NativeTabs.Trigger>

                <NativeTabs.Trigger name="library">
                    <NativeTabs.Trigger.Icon
                        sf={{
                            default: "rectangle.stack",
                            selected: "rectangle.stack.fill",
                        }}
                        md={{
                            default: "library_music",
                            selected: "library_music",
                        }}
                    />
                    <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
                </NativeTabs.Trigger>

                <NativeTabs.Trigger name="search" role="search">
                    <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
                    <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
                </NativeTabs.Trigger>
            </NativeTabs>

            <MediaPlayerFallbackOverlay
                hidden={hidden}
                failedArtworkUrl={failedArtworkUrl}
                onArtworkError={setFailedArtworkUrl}
            />
        </View>
    );
}

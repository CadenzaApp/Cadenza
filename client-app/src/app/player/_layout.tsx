import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useTheme } from "expo-router/react-navigation";
import { DynamicColorIOS, Platform } from "react-native";

import {
    PlayerScopeProvider,
    usePlayerScope,
} from "@/components/custom/media-player/player-scope";
import { DetailScreen } from "@/components/ui/detail-screen";
import { useArtworkTint } from "@/lib/artwork-color";
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

export default function PlayerLayout() {
    return (
        <PlayerScopeProvider>
            <PlayerTabs />
        </PlayerScopeProvider>
    );
}

/** A separate native tab controller presented inside the root player sheet. */
function PlayerTabs() {
    const { focusedSong } = usePlayerScope();
    const { tint } = useArtworkTint(focusedSong);
    const { colors } = useTheme();
    const selectedColor = Platform.OS === "ios" ? IOS_TAB_COLOR : colors.text;
    const unselectedColor =
        Platform.OS === "ios" ? IOS_UNSELECTED_TAB_COLOR : colors.text;

    return (
        <DetailScreen presentation="sheet" title="Now Playing" tint={tint}>
            <NativeTabs
                minimizeBehavior="never"
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
            >
                <NativeTabs.Trigger name="comments">
                    <NativeTabs.Trigger.Icon
                        sf={{
                            default: "bubble.left",
                            selected: "bubble.left.fill",
                        }}
                        md={{ default: "chat_bubble", selected: "chat_bubble" }}
                    />
                    <NativeTabs.Trigger.Label>
                        Comments
                    </NativeTabs.Trigger.Label>
                </NativeTabs.Trigger>

                <NativeTabs.Trigger name="index">
                    <NativeTabs.Trigger.Icon
                        sf="music.note"
                        md={{ default: "music_note", selected: "music_note" }}
                    />
                    <NativeTabs.Trigger.Label>Player</NativeTabs.Trigger.Label>
                </NativeTabs.Trigger>

                <NativeTabs.Trigger name="tags">
                    <NativeTabs.Trigger.Icon
                        sf={{ default: "tag", selected: "tag.fill" }}
                        md={{ default: "sell", selected: "sell" }}
                    />
                    <NativeTabs.Trigger.Label>Tags</NativeTabs.Trigger.Label>
                </NativeTabs.Trigger>
            </NativeTabs>
        </DetailScreen>
    );
}

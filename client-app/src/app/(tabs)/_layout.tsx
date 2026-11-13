import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { useTheme } from "expo-router/react-navigation";
import { DynamicColorIOS, Platform, View } from "react-native";

import { MediaPlayerFallbackOverlay } from "@/components/custom/media-player";
import { useAccount } from "@/lib/account";
import { ONBOARDING_HREF } from "@/features/onboarding/onboarding-step";
import { useOnboarding } from "@/features/onboarding/use-onboarding";
import { NativePlayerAccessory } from "@/components/custom/media-player/native-player-accessory";
import {
    useNativePlayerAccessoryEnabled,
    useBottomBarsHidden,
} from "@/lib/screen-overlay";
import { PALETTE, useAppTheme } from "@/lib/theme";

const IOS_UNSELECTED_TAB_COLOR =
    Platform.OS === "ios"
        ? DynamicColorIOS({
              light: PALETTE.light.mutedForeground,
              dark: PALETTE.dark.mutedForeground,
          })
        : PALETTE.light.mutedForeground;

/**
 * Every tab owns its scroll insets. Left on, UIKit adds its own to whichever
 * scroller it finds first in a tab's view tree: the status bar on top of the
 * floating rail's inset, and a bottom inset that changes as the player
 * shrinks into the tab bar, which jolts the page. `useScreenScroll` and
 * `useScreenOverlayInsets` supply the insets instead.
 */
const TRIGGER_PROPS = { disableAutomaticContentInsets: true } as const;

/**
 * The five primary routes, rendered by the platform's native tab controller.
 * Expanded playback uses the native accessory; circle and selection use the floating overlay.
 */
export default function TabLayout() {
    const { account } = useAccount();
    const { step } = useOnboarding();
    const { colors } = useTheme();
    const { colors: palette } = useAppTheme();
    const hidden = useBottomBarsHidden();
    const nativePlayer = useNativePlayerAccessoryEnabled();
    // the user's accent, the same in light and dark
    const selectedColor = palette.brand;
    const unselectedColor =
        Platform.OS === "ios" ? IOS_UNSELECTED_TAB_COLOR : colors.text;

    if (!account) {
        // SignOutHandler is already taking them to login
        return null;
    }
    if (step === "connect") {
        return <Redirect href={ONBOARDING_HREF.connect} />;
    }

    return (
        <View className="flex-1">
            <NativeTabs
                minimizeBehavior={nativePlayer ? "onScrollDown" : "never"}
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
                        bottomAccessoryHidden: hidden || !nativePlayer,
                    },
                }}
            >
                {nativePlayer ? (
                    <NativeTabs.BottomAccessory>
                        <NativePlayerAccessory />
                    </NativeTabs.BottomAccessory>
                ) : null}
                <NativeTabs.Trigger name="(social)" {...TRIGGER_PROPS}>
                    <NativeTabs.Trigger.Icon
                        sf={{
                            default: "person.2",
                            selected: "person.2.fill",
                        }}
                        md={{ default: "people", selected: "people" }}
                    />
                    <NativeTabs.Trigger.Label>Social</NativeTabs.Trigger.Label>
                </NativeTabs.Trigger>

                <NativeTabs.Trigger name="(analytics)" {...TRIGGER_PROPS}>
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

                <NativeTabs.Trigger name="(cadenza)" {...TRIGGER_PROPS}>
                    <NativeTabs.Trigger.Icon
                        sf="music.note.list"
                        md={{
                            default: "music_note",
                            selected: "music_note",
                        }}
                    />
                    <NativeTabs.Trigger.Label>Cadenza</NativeTabs.Trigger.Label>
                </NativeTabs.Trigger>

                <NativeTabs.Trigger name="(library)" {...TRIGGER_PROPS}>
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

                <NativeTabs.Trigger
                    name="(search)"
                    role="search"
                    {...TRIGGER_PROPS}
                >
                    <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
                    <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
                </NativeTabs.Trigger>
            </NativeTabs>

            <MediaPlayerFallbackOverlay
                hidden={hidden}
                nativeAccessoryActive={nativePlayer}
            />
        </View>
    );
}

import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useEffect, useRef, useState } from "react";
import {
    Pressable,
    ScrollView,
    StyleSheet,
    useWindowDimensions,
    View,
} from "react-native";
import Animated, {
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";

import { CommentsPage } from "./comments-page";
import { PlayerChromeProvider } from "./player-chrome";
import { PlayerPage } from "./player-page";
import { usePlayerScope } from "./player-scope";
import { TagsPage } from "./tags-page";
import { PLAYER_TABS, type PlayerTab, usePlayerTabs } from "./player-tabs";

const TAB_BAR_HEIGHT = 72;
const TAB_BAR_RADIUS = TAB_BAR_HEIGHT / 2;
/** Was 76%; the selector reads better with more room for three labels. */
const TAB_BAR_WIDTH_PERCENT = 91;
const SELECTION_INSET = 4;
const SELECTION_RADIUS = TAB_BAR_RADIUS - SELECTION_INSET;
const TAB_PRESENTATION = {
    comments: {
        label: "Comments",
        activeIcon: "chatbubble",
        inactiveIcon: "chatbubble-outline",
    },
    player: {
        label: "Player",
        activeIcon: "musical-note",
        inactiveIcon: "musical-note-outline",
    },
    tags: {
        label: "Tags",
        activeIcon: "pricetag",
        inactiveIcon: "pricetag-outline",
    },
} as const;

/** Three always-mounted pages in one native horizontal scroll surface. */
export function PlayerPager() {
    const { focusedSong, showTagsFor } = usePlayerScope();
    const { selectedTab, selectTab } = usePlayerTabs();
    const { width } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const scrollRef = useRef<ScrollView>(null);
    const scrollX = useSharedValue(PLAYER_TABS.indexOf(selectedTab) * width);
    const [tabBarWidth, setTabBarWidth] = useState(0);
    const [bottomChromeHeight, setBottomChromeHeight] = useState(0);
    const selectedIndex = PLAYER_TABS.indexOf(selectedTab);

    useEffect(() => {
        scrollRef.current?.scrollTo({
            x: selectedIndex * width,
            y: 0,
            animated: true,
        });
    }, [selectedIndex, width]);

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollX.value = event.contentOffset.x;
        },
    });
    const selectionStyle = useAnimatedStyle(() => {
        const itemWidth = tabBarWidth / PLAYER_TABS.length;
        return {
            width: itemWidth,
            transform: [
                {
                    translateX:
                        width > 0 ? (scrollX.value / width) * itemWidth : 0,
                },
            ],
        };
    });

    return (
        <PlayerChromeProvider bottomChromeHeight={bottomChromeHeight}>
            <View className="flex-1">
                <Animated.ScrollView
                    ref={scrollRef}
                    horizontal
                    pagingEnabled
                    bounces={false}
                    directionalLockEnabled
                    removeClippedSubviews={false}
                    showsHorizontalScrollIndicator={false}
                    scrollEventThrottle={16}
                    contentOffset={{ x: selectedIndex * width, y: 0 }}
                    onScroll={scrollHandler}
                    onMomentumScrollEnd={(event) => {
                        const index = Math.max(
                            0,
                            Math.min(
                                PLAYER_TABS.length - 1,
                                Math.round(
                                    event.nativeEvent.contentOffset.x / width,
                                ),
                            ),
                        );
                        selectTab(PLAYER_TABS[index]);
                    }}
                >
                    <View style={{ width }}>
                        <CommentsPage focusedSong={focusedSong} />
                    </View>
                    <View style={{ width }}>
                        <PlayerPage onModifyTags={showTagsFor} />
                    </View>
                    <View style={{ width }}>
                        <TagsPage focusedSong={focusedSong} />
                    </View>
                </Animated.ScrollView>

                <View
                    className="items-center px-4 pt-2"
                    style={{ paddingBottom: Math.max(insets.bottom, 8) }}
                    onLayout={(event) =>
                        setBottomChromeHeight(event.nativeEvent.layout.height)
                    }
                >
                    <View
                        className="relative flex-row overflow-hidden border border-border"
                        style={{
                            width: `${TAB_BAR_WIDTH_PERCENT}%`,
                            height: TAB_BAR_HEIGHT,
                            borderRadius: TAB_BAR_RADIUS,
                            borderCurve: "continuous",
                        }}
                        onLayout={(event) =>
                            setTabBarWidth(event.nativeEvent.layout.width)
                        }
                    >
                        {/* The glass carries its own radius rather than leaning on
                        the parent's clip. Native glass shapes its lensing and
                        its specular edge from its own corners, so a clipped
                        square reads as a flat fill instead of glass. Keep it
                        off the touch path; the native view ignores
                        `pointerEvents` and swallows the tab presses. */}
                        <View
                            pointerEvents="none"
                            style={StyleSheet.absoluteFill}
                        >
                            <GlassSurface
                                style={[
                                    StyleSheet.absoluteFill,
                                    {
                                        borderRadius: TAB_BAR_RADIUS - 1,
                                        borderCurve: "continuous",
                                    },
                                ]}
                            />
                        </View>
                        {tabBarWidth > 0 ? (
                            <Animated.View
                                pointerEvents="none"
                                className="absolute bottom-1 top-1"
                                style={selectionStyle}
                            >
                                <GlassSurface
                                    style={{
                                        flex: 1,
                                        borderRadius: SELECTION_RADIUS,
                                        borderCurve: "continuous",
                                        overflow: "hidden",
                                    }}
                                />
                            </Animated.View>
                        ) : null}
                        {PLAYER_TABS.map((tab) => (
                            <PlayerTabButton
                                key={tab}
                                tab={tab}
                                selected={selectedTab === tab}
                                onPress={() => selectTab(tab)}
                            />
                        ))}
                    </View>
                </View>
            </View>
        </PlayerChromeProvider>
    );
}

function PlayerTabButton({
    tab,
    selected,
    onPress,
}: {
    tab: PlayerTab;
    selected: boolean;
    onPress: () => void;
}) {
    const { colors } = useTheme();
    const presentation = TAB_PRESENTATION[tab];
    const icon = selected ? presentation.activeIcon : presentation.inactiveIcon;
    const label = presentation.label;

    return (
        <Pressable
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={onPress}
            className="flex-1 items-center justify-center active:opacity-70"
        >
            <Ionicons name={icon} size={26} color={colors.text} />
            <Text className="mt-0.5 text-xs font-medium">{label}</Text>
        </Pressable>
    );
}

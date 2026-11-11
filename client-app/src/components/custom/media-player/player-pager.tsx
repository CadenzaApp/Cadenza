import { useEffect, useRef, useState } from "react";
import {
    Platform,
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

import { GlassSurface } from "@/components/ui/glass-surface";
import { LiveSessionBar } from "@/features/live-session/LiveSessionBar";
import { useShownLiveSession } from "@/features/live-session/use-current-session";

import { DiscussPage } from "./discuss-page";
import {
    PLAYER_BAR_RADIUS,
    PlayerBarButton,
    PlayerBarShell,
} from "./player-bar";
import { PlayerPage } from "./player-page";
import { usePlayerScope } from "./player-scope";
import { TagsPage } from "./tags-page";
import { PLAYER_TABS, type PlayerTab, usePlayerTabs } from "./player-tabs";
import { QueueOpenContext } from "./queue-open";

const SELECTION_INSET = 4;
const SELECTION_RADIUS = PLAYER_BAR_RADIUS - SELECTION_INSET;
const TAB_PRESENTATION = {
    discuss: {
        label: "Discuss",
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

/**
 * Three always-mounted pages in one native horizontal scroll surface. In a
 * live session the tabs give way to the session's bar; the pages still swipe.
 */
export function PlayerPager() {
    const { focusedSong } = usePlayerScope();
    const liveSession = useShownLiveSession();
    const { selectedTab, selectTab } = usePlayerTabs();
    const { width } = useWindowDimensions();
    const scrollRef = useRef<ScrollView>(null);
    const scrollX = useSharedValue(PLAYER_TABS.indexOf(selectedTab) * width);
    const [tabBarWidth, setTabBarWidth] = useState(0);
    // the Player page's queue is a scroll view too, so it needs the region
    const [queueOpen, setQueueOpen] = useState(false);
    const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<PlayerTab>>(
        () => new Set([selectedTab]),
    );
    const selectedIndex = PLAYER_TABS.indexOf(selectedTab);

    function activateTab(tab: PlayerTab) {
        setVisitedTabs((current) =>
            current.has(tab) ? current : new Set([...current, tab]),
        );
        selectTab(tab);
    }

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
        <View className="flex-1">
            <View className="flex-1">
                <SheetScrollRegion
                    active={selectedTab !== "player" || queueOpen}
                />
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
                        activateTab(PLAYER_TABS[index]);
                    }}
                >
                    <View style={{ width }}>
                        <DiscussPage
                            focusedSong={focusedSong}
                            enabled={visitedTabs.has("discuss")}
                            active={selectedTab === "discuss"}
                        />
                    </View>
                    <View style={{ width }}>
                        <QueueOpenContext.Provider value={setQueueOpen}>
                            <PlayerPage />
                        </QueueOpenContext.Provider>
                    </View>
                    <View style={{ width }}>
                        <TagsPage
                            focusedSong={focusedSong}
                            enabled={visitedTabs.has("tags")}
                        />
                    </View>
                </Animated.ScrollView>
            </View>

            {liveSession ? (
                <LiveSessionBar session={liveSession} />
            ) : (
                <PlayerBarShell
                    onLayout={(event) =>
                        setTabBarWidth(event.nativeEvent.layout.width)
                    }
                >
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
                    {PLAYER_TABS.map((tab) => {
                        const look = TAB_PRESENTATION[tab];
                        const selected = selectedTab === tab;
                        return (
                            <PlayerBarButton
                                key={tab}
                                role="tab"
                                selected={selected}
                                icon={
                                    selected
                                        ? look.activeIcon
                                        : look.inactiveIcon
                                }
                                label={look.label}
                                onPress={() => activateTab(tab)}
                            />
                        );
                    })}
                </PlayerBarShell>
            )}
        </View>
    );
}

/**
 * Android only: tells the native sheet where its content scrolls.
 *
 * Android's sheet is a Material `BottomSheetBehavior`. It lets a vertical drag
 * through to the content only inside one view, the first nested-scrolling view
 * it finds when it lays out, and takes every other vertical drag to move the
 * sheet. Left alone it finds Discuss's pull-to-refresh list, the first page, so
 * the Tags page could not scroll at all.
 *
 * This empty scroll view is placed first so it is the one the sheet finds, and
 * it covers the pages while Discuss or Tags is selected, or while the Player
 * page shows its queue, so their own scroll views get the drag. On Player with
 * the artwork showing it shrinks to nothing, so pulling the artwork down still
 * drags the sheet closed. It is underneath the pager and takes no
 * touches; the sheet only measures its bounds. iOS needs none of this.
 */
function SheetScrollRegion({ active }: { active: boolean }) {
    if (Platform.OS !== "android") return null;
    return (
        <ScrollView
            nestedScrollEnabled
            scrollEnabled={false}
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={active ? StyleSheet.absoluteFill : styles.collapsedRegion}
        />
    );
}

const styles = StyleSheet.create({
    collapsedRegion: {
        position: "absolute",
        top: 0,
        left: 0,
        width: 0,
        height: 0,
    },
});

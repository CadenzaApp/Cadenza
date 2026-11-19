import { useNavigation } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
    Platform,
    ScrollView,
    StyleSheet,
    useWindowDimensions,
    View,
} from "react-native";
import { usePanGesture } from "react-native-gesture-handler";
import Animated, {
    runOnJS,
    scrollTo,
    useAnimatedRef,
    useAnimatedScrollHandler,
    useSharedValue,
} from "react-native-reanimated";

import { Text } from "@/components/ui/text";
import { LiveSessionBar } from "@/features/live-session/LiveSessionBar";
import { useShownLiveSession } from "@/features/live-session/use-current-session";

import { DiscussPage } from "./discuss-page";
import { PLAYER_BAR_INSET, PlayerBarShell, PlayerTabIcons } from "./player-bar";
import { pageOffsetAtBarX, releasedPageIndex } from "./player-bar-drag";
import { PlayerPage } from "./player-page";
import { usePlayerScope } from "./player-scope";
import { TagsPage } from "./tags-page";
import { PLAYER_TABS, type PlayerTab, usePlayerTabs } from "./player-tabs";
import { QueueOpenContext } from "./queue-open";

/**
 * Three always-mounted pages in one native horizontal scroll surface. In a
 * live session the tabs give way to the session's bar; the pages still swipe.
 */
export function PlayerPager() {
    const { focusedSong } = usePlayerScope();
    const navigation = useNavigation();
    const holdSheetForBar = useCallback(
        (touching: boolean) => {
            if (Platform.OS === "ios")
                navigation.setOptions({ gestureEnabled: !touching });
        },
        [navigation],
    );
    useEffect(() => () => holdSheetForBar(false), [holdSheetForBar]);
    const liveSession = useShownLiveSession();
    const { selectedTab, selectTab } = usePlayerTabs();
    const { width } = useWindowDimensions();
    const scrollRef = useAnimatedRef<ScrollView>();
    const barDragging = useSharedValue(false);
    const barPanActive = useSharedValue(false);
    const barPressTarget = useSharedValue(-1);
    const scrollX = useSharedValue(PLAYER_TABS.indexOf(selectedTab) * width);
    const [tabBarWidth, setTabBarWidth] = useState(0);
    // the Player page's queue is a scroll view too, so it needs the region
    const [queueOpen, setQueueOpen] = useState(false);
    const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<PlayerTab>>(
        () => new Set([selectedTab]),
    );
    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            setVisitedTabs(new Set(PLAYER_TABS));
        });
        return () => cancelAnimationFrame(frame);
    }, []);
    const selectedIndex = PLAYER_TABS.indexOf(selectedTab);
    // The first page only. A changed `contentOffset` prop jumps UIKit's scroll
    // view without animating, which skipped the slide on every tab tap.
    const [initialOffset] = useState(() => ({
        x: selectedIndex * width,
        y: 0,
    }));

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
    }, [selectedIndex, width, scrollRef]);

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollX.value = event.contentOffset.x;
        },
    });
    const barDrag = usePanGesture({
        enabled: !liveSession && tabBarWidth > 0,
        minDistance: 0,
        failOffsetY: [-12, 12],
        maxPointers: 1,
        onTouchesDown: (event) => {
            "worklet";
            const touch = event.changedTouches[0];
            if (!touch) return;
            barDragging.set(true);
            barPanActive.set(false);
            runOnJS(holdSheetForBar)(true);
            const itemWidth =
                (tabBarWidth - PLAYER_BAR_INSET * 2) / PLAYER_TABS.length;
            const offset = pageOffsetAtBarX(
                touch.x,
                itemWidth,
                width,
                PLAYER_TABS.length,
                PLAYER_BAR_INSET,
            );
            const nearest =
                releasedPageIndex(
                    offset,
                    0,
                    itemWidth,
                    width,
                    PLAYER_TABS.length,
                ) * width;
            barPressTarget.set(Math.round(nearest / width));
            // Native scroll events drive the pill throughout the initial animation.
            // A drag update interrupts this animation at the absolute finger position.
            scrollTo(scrollRef, nearest, 0, true);
        },
        onActivate: () => {
            "worklet";
            barPanActive.set(true);
        },
        onTouchesUp: () => {
            "worklet";
            // A stationary tap can end before the pan recognizer activates.
            if (!barDragging.get() || barPanActive.get()) return;
            const index = Math.max(
                0,
                Math.min(
                    PLAYER_TABS.length - 1,
                    barPressTarget.get() >= 0
                        ? barPressTarget.get()
                        : Math.round(scrollX.get() / width),
                ),
            );
            barDragging.set(false);
            scrollTo(scrollRef, index * width, 0, true);
            runOnJS(activateTab)(PLAYER_TABS[index]);
        },
        onUpdate: (event) => {
            "worklet";
            const itemWidth =
                (tabBarWidth - PLAYER_BAR_INSET * 2) / PLAYER_TABS.length;
            const offset = pageOffsetAtBarX(
                event.x,
                itemWidth,
                width,
                PLAYER_TABS.length,
                PLAYER_BAR_INSET,
            );
            barPressTarget.set(-1);
            scrollX.set(offset);
            scrollTo(scrollRef, offset, 0, false);
        },
        onDeactivate: (event) => {
            "worklet";
            const itemWidth =
                (tabBarWidth - PLAYER_BAR_INSET * 2) / PLAYER_TABS.length;
            const index = event.canceled
                ? selectedIndex
                : barPressTarget.get() >= 0
                  ? barPressTarget.get()
                  : releasedPageIndex(
                        scrollX.get(),
                        event.velocityX,
                        itemWidth,
                        width,
                        PLAYER_TABS.length,
                    );
            barDragging.set(false);
            // Scroll explicitly even when returning to the already-selected tab.
            scrollTo(scrollRef, index * width, 0, true);
            if (!event.canceled) runOnJS(activateTab)(PLAYER_TABS[index]);
        },
        onFinalize: (event) => {
            "worklet";
            runOnJS(holdSheetForBar)(false);
            if (event.canceled && barDragging.get()) {
                barDragging.set(false);
                scrollTo(scrollRef, selectedIndex * width, 0, true);
            }
        },
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
                    contentOffset={initialOffset}
                    onScroll={scrollHandler}
                    onMomentumScrollEnd={(event) => {
                        if (barDragging.get()) return;
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
                        {focusedSong ? (
                            <DiscussPage
                                focusedSong={focusedSong}
                                enabled={visitedTabs.has("discuss")}
                                active={selectedTab === "discuss"}
                            />
                        ) : (
                            <NoSongPage />
                        )}
                    </View>
                    <View style={{ width }}>
                        <QueueOpenContext.Provider value={setQueueOpen}>
                            <PlayerPage />
                        </QueueOpenContext.Provider>
                    </View>
                    <View style={{ width }}>
                        {focusedSong ? (
                            <TagsPage
                                focusedSong={focusedSong}
                                enabled={visitedTabs.has("tags")}
                            />
                        ) : (
                            <NoSongPage />
                        )}
                    </View>
                </Animated.ScrollView>
            </View>

            {liveSession ? (
                <LiveSessionBar session={liveSession} />
            ) : (
                <PlayerBarShell
                    gesture={barDrag}
                    onLayout={(event) =>
                        setTabBarWidth(event.nativeEvent.layout.width)
                    }
                >
                    <PlayerTabIcons
                        barWidth={tabBarWidth}
                        pageWidth={width}
                        scrollX={scrollX}
                        selectedTab={selectedTab}
                        onSelect={activateTab}
                    />
                </PlayerBarShell>
            )}
        </View>
    );
}

/** Discuss and Tags in a live session with nothing playing. */
function NoSongPage() {
    return (
        <View className="flex-1 items-center justify-center px-6">
            <Text className="text-center text-muted-foreground">
                Nothing playing yet.
            </Text>
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

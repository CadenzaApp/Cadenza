import type { SFSymbol } from "expo-symbols";
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

import type { IoniconName } from "@/components/ui/ionicon-name";
import { Text } from "@/components/ui/text";
import { LiveSessionBar } from "@/features/live-session/LiveSessionBar";
import { useShownLiveSession } from "@/features/live-session/use-current-session";
import { useAppTheme } from "@/lib/theme";

import { DiscussPage } from "./discuss-page";
import {
    PLAYER_BAR_INSET,
    PLAYER_BAR_RADIUS,
    PlayerBarButton,
    PlayerBarShell,
} from "./player-bar";
import { PlayerPage } from "./player-page";
import { usePlayerScope } from "./player-scope";
import { TagsPage } from "./tags-page";
import { PLAYER_TABS, type PlayerTab, usePlayerTabs } from "./player-tabs";
import { QueueOpenContext } from "./queue-open";

const SELECTION_RADIUS = PLAYER_BAR_RADIUS - PLAYER_BAR_INSET;
/** The pill sits darker than the glass, like the native tab bar's. */
const SELECTION_FILL = {
    light: "rgba(0, 0, 0, 0.08)",
    dark: "rgba(0, 0, 0, 0.35)",
} as const;
/** How much wider the pill gets halfway between two tabs, like UIKit's. */
const SELECTION_STRETCH = 0.12;
const TAB_PRESENTATION = {
    discuss: {
        label: "Discuss",
        sf: { active: "bubble.left.fill", inactive: "bubble.left" },
        icon: { active: "chatbubble", inactive: "chatbubble-outline" },
    },
    player: {
        label: "Player",
        sf: { active: "music.note", inactive: "music.note" },
        icon: { active: "musical-note", inactive: "musical-note-outline" },
    },
    tags: {
        label: "Tags",
        sf: { active: "tag.fill", inactive: "tag" },
        icon: { active: "pricetag", inactive: "pricetag-outline" },
    },
} as const satisfies Record<
    PlayerTab,
    {
        label: string;
        sf: Record<"active" | "inactive", SFSymbol>;
        icon: Record<"active" | "inactive", IoniconName>;
    }
>;

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
    // The first page only. A changed `contentOffset` prop jumps UIKit's scroll
    // view without animating, which skipped the slide on every tab tap.
    const [initialOffset] = useState(() => ({
        x: selectedIndex * width,
        y: 0,
    }));
    const { scheme } = useAppTheme();

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
        const itemWidth =
            (tabBarWidth - PLAYER_BAR_INSET * 2) / PLAYER_TABS.length;
        const position = width > 0 ? scrollX.value / width : 0;
        // 0 on a tab, 1 halfway to the next
        const between = Math.sin(Math.PI * (position - Math.floor(position)));
        const stretch = itemWidth * SELECTION_STRETCH * between;
        return {
            width: itemWidth + stretch,
            transform: [{ translateX: position * itemWidth - stretch / 2 }],
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
                    contentOffset={initialOffset}
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
                    onLayout={(event) =>
                        setTabBarWidth(event.nativeEvent.layout.width)
                    }
                >
                    {tabBarWidth > 0 ? (
                        <Animated.View
                            pointerEvents="none"
                            className="absolute"
                            style={[
                                {
                                    top: PLAYER_BAR_INSET,
                                    bottom: PLAYER_BAR_INSET,
                                    left: PLAYER_BAR_INSET,
                                    borderRadius: SELECTION_RADIUS,
                                    borderCurve: "continuous",
                                    backgroundColor: SELECTION_FILL[scheme],
                                },
                                selectionStyle,
                            ]}
                        />
                    ) : null}
                    {PLAYER_TABS.map((tab) => {
                        const look = TAB_PRESENTATION[tab];
                        const selected = selectedTab === tab;
                        return (
                            <PlayerBarButton
                                key={tab}
                                role="tab"
                                selected={selected}
                                sf={look.sf[selected ? "active" : "inactive"]}
                                icon={
                                    look.icon[selected ? "active" : "inactive"]
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

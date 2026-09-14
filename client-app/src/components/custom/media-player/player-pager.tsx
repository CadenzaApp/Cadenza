import type { MusicItem } from "@apple-musickit";
import { useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useDerivedValue,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CommentsPage } from "./comments-page";
import { MiniTabBar, PLAYER_PAGE_KEYS, type PlayerPageKey } from "./mini-tab-bar";
import { PlayerPage } from "./player-page";
import { TagsPage } from "./tags-page";

const SWIPE = { duration: 260, easing: Easing.out(Easing.cubic) };
/** How far, or how fast, a drag has to go to change the page. */
const SWIPE_DISTANCE_RATIO = 0.25;
const SWIPE_VELOCITY_THRESHOLD = 600;

export type FocusedSong = {
    id: string;
    title: string;
    artworkUrl?: string;
    artworkColor?: string;
};

function focusedSongFromTrack(track: MusicItem): FocusedSong {
    return {
        id: track.catalogId ?? track.id,
        title: track.title,
        artworkUrl: track.artworkUrl,
        artworkColor: track.artworkColor,
    };
}

/**
 * The now playing sheet's three pages: Comments, Player, Tags, with a small
 * glass tab bar of its own at the bottom. Player is the default and the only
 * one that touches playback; Comments and Tags both address `focusedSong`,
 * which starts as whatever `app/player.tsx` resolved from the route (the
 * playing track, or a target song id from Modify Tags on a song that was not
 * playing) and can be retargeted in place by Modify Tags on the Player page's
 * own menu.
 *
 * The swipe gesture never fights the scrubber's own pan for a drag that
 * starts on it: the scrubber activates at 4px (`activeOffsetX([-4, 4])`,
 * `PlayerPage`), tighter than this pager's 10px, so on any real drag the
 * scrubber's pan wins the race and the pager's never gets the chance to
 * activate - the same threshold-race arbitration `seekGesture` already uses
 * between its own pan and tap. This pager also keeps `failOffsetY`, so a
 * vertical pull still reaches the sheet's native dismiss - see the
 * media-player README gotcha about widening that.
 */
export function PlayerPager({
    initialPage,
    focusedSong,
}: {
    initialPage: "player" | "tags";
    focusedSong: FocusedSong;
}) {
    const { width } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const initialIndex = PLAYER_PAGE_KEYS.indexOf(initialPage);
    const [pageIndex, setPageIndex] = useState(initialIndex);
    const [currentFocusedSong, setCurrentFocusedSong] =
        useState<FocusedSong>(focusedSong);
    const translateX = useSharedValue(-initialIndex * width);
    const position = useDerivedValue(() => -translateX.value / (width || 1));

    function goToPage(index: number) {
        const clamped = Math.max(
            0,
            Math.min(index, PLAYER_PAGE_KEYS.length - 1),
        );
        translateX.value = withTiming(-clamped * width, SWIPE);
        setPageIndex(clamped);
    }

    function goToTagsFor(track: MusicItem) {
        setCurrentFocusedSong(focusedSongFromTrack(track));
        goToPage(PLAYER_PAGE_KEYS.indexOf("tags" satisfies PlayerPageKey));
    }

    const panGesture = Gesture.Pan()
        .activeOffsetX([-10, 10])
        .failOffsetY([-15, 15])
        .onUpdate((event) => {
            translateX.value = -pageIndex * width + event.translationX;
        })
        .onEnd((event) => {
            const pastThreshold =
                Math.abs(event.translationX) > width * SWIPE_DISTANCE_RATIO ||
                Math.abs(event.velocityX) > SWIPE_VELOCITY_THRESHOLD;
            const direction = event.translationX < 0 ? 1 : -1;
            const next = pastThreshold ? pageIndex + direction : pageIndex;
            runOnJS(goToPage)(next);
        });

    const trackStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: translateX.value }],
    }));

    return (
        <View className="flex-1">
            <GestureDetector gesture={panGesture}>
                <View className="flex-1" style={{ overflow: "hidden" }}>
                    <Animated.View
                        style={[
                            {
                                flex: 1,
                                flexDirection: "row",
                                width: width * PLAYER_PAGE_KEYS.length,
                            },
                            trackStyle,
                        ]}
                    >
                        <View style={{ width }}>
                            <CommentsPage focusedSong={currentFocusedSong} />
                        </View>
                        <View style={{ width }}>
                            <PlayerPage onModifyTags={goToTagsFor} />
                        </View>
                        <View style={{ width }}>
                            <TagsPage focusedSong={currentFocusedSong} />
                        </View>
                    </Animated.View>
                </View>
            </GestureDetector>

            <View
                className="px-4 pt-2"
                style={{ paddingBottom: insets.bottom || 12 }}
            >
                <MiniTabBar position={position} onSelect={goToPage} />
            </View>
        </View>
    );
}

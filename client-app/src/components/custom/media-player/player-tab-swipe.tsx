import { useRouter } from "expo-router";
import { useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

export type PlayerTab = "comments" | "player" | "tags";

const TABS: PlayerTab[] = ["comments", "player", "tags"];
const ROUTES = {
    comments: "/player/comments",
    player: "/player",
    tags: "/player/tags",
} as const;
const DISTANCE = 56;
const VELOCITY = 600;

/** Adds horizontal paging gestures while NativeTabs still owns tab selection. */
export function PlayerTabSwipe({
    tab,
    children,
}: {
    tab: PlayerTab;
    children: ReactNode;
}) {
    const router = useRouter();
    const gesture = useMemo(
        () =>
            Gesture.Pan()
                // The scrubber claims at 4 points, before this page gesture.
                .activeOffsetX([-12, 12])
                .failOffsetY([-16, 16])
                .onEnd((event) => {
                    const changesTab =
                        Math.abs(event.translationX) >= DISTANCE ||
                        Math.abs(event.velocityX) >= VELOCITY;
                    if (!changesTab) return;

                    const current = TABS.indexOf(tab);
                    const direction = event.translationX < 0 ? 1 : -1;
                    const target = TABS[current + direction];
                    if (target) runOnJS(router.navigate)(ROUTES[target]);
                }),
        [router, tab],
    );

    return (
        <GestureDetector gesture={gesture}>
            <View className="flex-1">{children}</View>
        </GestureDetector>
    );
}

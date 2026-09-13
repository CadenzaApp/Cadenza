import { useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useCallback, useMemo, useState } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
    runOnJS,
    useSharedValue,
    type SharedValue,
} from "react-native-reanimated";

import { MediaPlayerCompact, type PlayerRect } from "./compact";
import { usePlayback } from "@/lib/playback";
import { DOCKED_PLAYER_SLOTS, usePlayerDock } from "@/lib/player-dock";
import {
    COMPACT_PLAYER_HEIGHT,
    DOCKED_PLAYER_HEIGHT,
    TAB_BAR_MARGIN,
    useScreenOverlayInsets,
} from "@/lib/screen-overlay";

/** Past this much of the way down, letting go docks rather than springs back. */
const DOCK_COMMIT = 0.5;
const FLICK_VELOCITY = 600;

type DockGestureHandlers = {
    onDock: () => void;
    onFloat: () => void;
    onOpenPlayer: () => void;
};

/**
 * The drag that moves the player between floating and docked. A plain function
 * rather than a hook, so the shared values arrive as arguments and the gesture
 * can write them.
 *
 * `travel` is the real distance between the two resting places, so the bar
 * tracks the finger one to one instead of at some invented rate.
 */
function createDockGesture(
    progress: SharedValue<number>,
    dragStart: SharedValue<number>,
    travel: number,
    handlers: DockGestureHandlers,
) {
    return Gesture.Pan()
        .activeOffsetY([-10, 10])
        .failOffsetX([-20, 20])
        .onStart(() => {
            dragStart.value = progress.value;
        })
        .onChange((event) => {
            const next = dragStart.value + event.translationY / travel;
            progress.value = Math.min(1, Math.max(0, next));
        })
        .onEnd((event) => {
            // An upward flick from the floating bar is still the shortcut into
            // the now playing sheet, so it has to be checked before docking.
            if (
                dragStart.value === 0 &&
                progress.value === 0 &&
                (event.translationY < -24 || event.velocityY < -450)
            ) {
                runOnJS(handlers.onOpenPlayer)();
                return;
            }

            const docked =
                event.velocityY > FLICK_VELOCITY
                    ? true
                    : event.velocityY < -FLICK_VELOCITY
                      ? false
                      : progress.value > DOCK_COMMIT;
            runOnJS(docked ? handlers.onDock : handlers.onFloat)();
        });
}

/**
 * The persistent mini player. It floats above the tab bar and survives
 * navigation because `MediaPlayerHost` mounts it outside the navigator.
 * Tapping it opens the `player` route, which is the now playing sheet.
 *
 * It has two resting places. Floating above the bar, and docked inside it over
 * the middle tab slots, which is where scrolling a page sends it. Both come
 * from `useScreenOverlayInsets`, so the bar and the padding screens leave for
 * it can never disagree. Which one it is in is `usePlayerDock`.
 */
export function MediaPlayer() {
    const {
        activeTrack,
        isPlaying,
        isLoading,
        togglePlayback,
        skipToNext,
        canSkipToNext,
    } = usePlayback();
    const router = useRouter();
    const { colors } = useTheme();
    const { compactPlayerBottom, dockedPlayerBottom, playerCanDock } =
        useScreenOverlayInsets();
    const { progress, dock, float, barWidth, tabCount } = usePlayerDock();
    const [failedArtworkUrl, setFailedArtworkUrl] = useState<string | null>(
        null,
    );
    // Where the drag picked the bar up from, so a drag that starts docked
    // moves relative to that rather than snapping to the finger.
    const dragStart = useSharedValue(0);

    const artworkUrl = activeTrack?.artworkUrl?.trim();
    const canRenderArtwork =
        typeof artworkUrl === "string" &&
        artworkUrl !== failedArtworkUrl &&
        /^https?:\/\//i.test(artworkUrl);

    const floatingRect: PlayerRect = {
        bottom: compactPlayerBottom,
        inset: TAB_BAR_MARGIN,
        height: COMPACT_PLAYER_HEIGHT,
    };
    // Docked, it covers the middle slots and leaves the outer ones alone, so
    // its side inset is however many slots are left over, halved. Until the bar
    // has measured itself there are no slots, so it stays where it is.
    const slotWidth = tabCount > 0 ? barWidth / tabCount : 0;
    const sideSlots = (tabCount - DOCKED_PLAYER_SLOTS) / 2;
    // A sheet hides the bar while leaving its last measurement in context.
    // Do not dock into geometry that is currently behind the sheet.
    const dockable = playerCanDock && sideSlots > 0 && slotWidth > 0;
    const dockedRect: PlayerRect = dockable
        ? {
              bottom: dockedPlayerBottom,
              inset: TAB_BAR_MARGIN + slotWidth * sideSlots,
              height: DOCKED_PLAYER_HEIGHT,
          }
        : floatingRect;

    const openPlayer = useCallback(() => {
        router.push("/player");
    }, [router]);

    const travel = Math.max(1, floatingRect.bottom - dockedRect.bottom);
    const gesture = useMemo(
        () =>
            createDockGesture(progress, dragStart, travel, {
                onDock: dock,
                onFloat: float,
                onOpenPlayer: openPlayer,
            }),
        [progress, dragStart, travel, dock, float, openPlayer],
    );

    if (!activeTrack) return null;

    return (
        <GestureDetector gesture={gesture}>
            <MediaPlayerCompact
                track={activeTrack}
                artworkUrl={artworkUrl}
                canRenderArtwork={canRenderArtwork}
                isPlaying={isPlaying}
                isLoading={isLoading}
                canSkipToNext={canSkipToNext}
                floatingRect={floatingRect}
                dockedRect={dockedRect}
                dockProgress={progress}
                textColor={colors.text}
                onExpand={openPlayer}
                onArtworkError={() => setFailedArtworkUrl(artworkUrl ?? null)}
                onTogglePlayback={() => void togglePlayback(activeTrack)}
                onSkipToNext={() => void skipToNext()}
            />
        </GestureDetector>
    );
}

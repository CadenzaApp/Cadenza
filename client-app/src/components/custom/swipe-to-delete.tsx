import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
    runOnJS,
    useAnimatedReaction,
    useAnimatedStyle,
    type SharedValue,
} from "react-native-reanimated";

/** How much red a swipe opens to and stays at. */
const ACTION_WIDTH = 76;
/** Pulled past this much of the row and let go, the row deletes. */
const FULL_SWIPE = 0.5;

/**
 * A row that swipes left to delete, the way Apple's lists do: the row slides
 * over a red area with a white trash centered in what shows, and the red
 * follows the finger. Let go past half the row and it deletes; short of that
 * it rests open, and the trash deletes on tap. `children` should paint its own
 * background, so the red stays behind it.
 *
 * `bleed` runs the row that far past each side, out of a list's side padding,
 * so the red comes in from the screen's edge rather than where the row's text
 * ends. The children then pad themselves back in by the same amount.
 */
export function SwipeToDelete({
    onDelete,
    accessibilityLabel = "Delete",
    bleed = 0,
    children,
}: {
    onDelete: () => void;
    accessibilityLabel?: string;
    bleed?: number;
    children: ReactNode;
}) {
    const [rowWidth, setRowWidth] = useState(0);
    // whether the finger is past a full swipe, read once it lets go
    const pastFull = useRef(false);
    const setPastFull = (past: boolean) => {
        pastFull.current = past;
    };

    return (
        <View
            style={{ marginHorizontal: -bleed }}
            onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
        >
            <ReanimatedSwipeable
                friction={1}
                rightThreshold={ACTION_WIDTH / 2}
                overshootRight
                onSwipeableWillOpen={() => {
                    if (pastFull.current) onDelete();
                }}
                renderRightActions={(_progress, translation, swipeable) => (
                    <DeleteAction
                        translation={translation}
                        rowWidth={rowWidth}
                        accessibilityLabel={accessibilityLabel}
                        onPastFull={setPastFull}
                        onPress={() => {
                            swipeable.close();
                            onDelete();
                        }}
                    />
                )}
            >
                {children}
            </ReanimatedSwipeable>
        </View>
    );
}

function DeleteAction({
    translation,
    rowWidth,
    accessibilityLabel,
    onPastFull,
    onPress,
}: {
    translation: SharedValue<number>;
    rowWidth: number;
    accessibilityLabel: string;
    onPastFull: (past: boolean) => void;
    onPress: () => void;
}) {
    useAnimatedReaction(
        () => rowWidth > 0 && -translation.value > rowWidth * FULL_SWIPE,
        (past, before) => {
            if (past !== before) runOnJS(onPastFull)(past);
        },
        [rowWidth],
    );

    // the trash stays centered in the red that shows
    const iconStyle = useAnimatedStyle(() => {
        const shown = -translation.value;
        return {
            transform: [
                {
                    translateX:
                        shown > ACTION_WIDTH ? (ACTION_WIDTH - shown) / 2 : 0,
                },
            ],
        };
    });

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            onPress={onPress}
            style={{ width: ACTION_WIDTH }}
        >
            {/* runs left under the row, so an overshoot is red all the way */}
            <View
                pointerEvents="none"
                className="absolute bottom-0 right-0 top-0 bg-destructive"
                style={{ width: Math.max(rowWidth, ACTION_WIDTH) }}
            />
            <Animated.View
                className="flex-1 items-center justify-center"
                style={iconStyle}
            >
                <Ionicons name="trash" size={22} color="#ffffff" />
            </Animated.View>
        </Pressable>
    );
}

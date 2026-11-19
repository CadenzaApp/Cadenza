import { useCallback, useEffect, useRef } from "react";
import { Keyboard, Platform, type KeyboardEvent } from "react-native";
import {
    cancelAnimation,
    Easing,
    scrollTo,
    useAnimatedReaction,
    useScrollOffset,
    useSharedValue,
    withTiming,
    type AnimatedRef,
} from "react-native-reanimated";

/** What `useScrollOffset` and `scrollTo` take a ref to. */
type Scrollable =
    Parameters<typeof scrollTo>[0] extends AnimatedRef<infer T> ? T : never;

/** iOS's keyboard curve, near enough that a scroll and the keyboard move as one. */
export const KEYBOARD_EASING = Easing.bezier(0.38, 0.7, 0.125, 1);
/** The keyboard's usual time to rise, for when no show event comes. */
export const KEYBOARD_DURATION_MS = 250;
/** How long to wait for the keyboard before scrolling without it. */
const KEYBOARD_WAIT_MS = 120;

/**
 * Scrolls a list to a spot in step with the keyboard rising, so something
 * that opens the keyboard (an inline composer) is carried up into place by
 * it, not jumped there before or after. `scrollWithKeyboard(y)` arms it: the
 * next keyboard show runs the scroll from where the list is to `y` over the
 * keyboard's own duration, on the UI thread. A keyboard already up, or one
 * that never shows, still gets the scroll, on the usual timing.
 */
export function useKeyboardScroll<T extends Scrollable>(ref: AnimatedRef<T>) {
    const offset = useScrollOffset(ref);
    const y = useSharedValue(0);
    const driving = useSharedValue(false);
    const pending = useRef<number | null>(null);
    const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);

    useAnimatedReaction(
        () => y.get(),
        (next) => {
            if (driving.get()) scrollTo(ref, 0, next, false);
        },
    );

    const run = useCallback(
        (target: number, duration: number) => {
            cancelAnimation(y);
            y.set(offset.get());
            driving.set(true);
            y.set(
                withTiming(
                    target,
                    { duration, easing: KEYBOARD_EASING },
                    () => {
                        driving.set(false);
                    },
                ),
            );
        },
        [driving, offset, y],
    );

    useEffect(() => {
        const event =
            Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
        const sub = Keyboard.addListener(event, (e: KeyboardEvent) => {
            const target = pending.current;
            if (target === null) return;
            pending.current = null;
            if (fallback.current) clearTimeout(fallback.current);
            run(target, e.duration || KEYBOARD_DURATION_MS);
        });
        return () => {
            sub.remove();
            if (fallback.current) clearTimeout(fallback.current);
        };
    }, [run]);

    return useCallback(
        (target: number) => {
            pending.current = target;
            if (fallback.current) clearTimeout(fallback.current);
            fallback.current = setTimeout(() => {
                if (pending.current === null) return;
                pending.current = null;
                run(target, KEYBOARD_DURATION_MS);
            }, KEYBOARD_WAIT_MS);
        },
        [run],
    );
}

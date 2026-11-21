import { useEffect, useState, type RefObject } from "react";
import {
    Dimensions,
    Keyboard,
    LayoutAnimation,
    Platform,
    type KeyboardEvent,
    type View,
} from "react-native";

/**
 * How far the keyboard reaches up over the bottom of `bodyRef`, in points, or
 * 0 while it is down. Measured against the view's place in the window rather
 * than assumed, since neither platform moves a native sheet for the keyboard:
 * iOS leaves the sheet where it is and `KeyboardAvoidingView` does not see its
 * frame, and react-native-screens' Android sheet stays put at a single detent
 * even though the window resizes. A view the system already moved clear of the
 * keyboard measures 0, so nothing is padded twice.
 */
export function useKeyboardOverlap(bodyRef: RefObject<View | null>) {
    const [overlap, setOverlap] = useState(0);

    useEffect(() => {
        const ios = Platform.OS === "ios";
        const animate = (event: KeyboardEvent) => {
            // Android has no will-show event to animate alongside
            if (!ios) return;
            LayoutAnimation.configureNext({
                duration: event.duration || 250,
                update: { type: LayoutAnimation.Types.keyboard },
            });
        };
        const shown = Keyboard.addListener(
            ios ? "keyboardWillShow" : "keyboardDidShow",
            (event) => {
                const { screenY, height } = event.endCoordinates;
                const keyboardTop =
                    screenY > 0
                        ? screenY
                        : Dimensions.get("screen").height - height;
                bodyRef.current?.measureInWindow(
                    (_x, y, _width, viewHeight) => {
                        animate(event);
                        setOverlap(Math.max(0, y + viewHeight - keyboardTop));
                    },
                );
            },
        );
        const hidden = Keyboard.addListener(
            ios ? "keyboardWillHide" : "keyboardDidHide",
            (event) => {
                animate(event);
                setOverlap(0);
            },
        );
        return () => {
            shown.remove();
            hidden.remove();
        };
    }, [bodyRef]);

    return overlap;
}

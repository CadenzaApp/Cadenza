import { useNavigation } from "expo-router";
import { useEffect, useState } from "react";

/** In case the transition's end is missed, how long to wait before going on. */
const FALLBACK_MS = 700;

/**
 * False while this screen's open transition is still running, then true for
 * good. With `animated` false there is no transition to wait for, so it is
 * true from the start.
 *
 * For holding back heavy rendering until the screen has arrived. Views built
 * during the push run on the same main thread the animation needs, so a list
 * whose data is already cached made every open stutter.
 */
export function useOpenTransitionSettled(animated: boolean) {
    const navigation = useNavigation();
    const [settled, setSettled] = useState(!animated);

    useEffect(() => {
        if (settled) return;
        const done = () => setSettled(true);
        const unsubscribe = navigation.addListener(
            "transitionEnd" as never,
            done,
        );
        const timer = setTimeout(done, FALLBACK_MS);
        return () => {
            unsubscribe();
            clearTimeout(timer);
        };
    }, [navigation, settled]);

    return settled;
}

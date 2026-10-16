import { useNavigation } from "expo-router";
import { useEffect, useState } from "react";

import { useZoomOpened } from "./zoom-dismiss";

/** In case the transition's end is missed, how long to wait before going on. */
const FALLBACK_MS = 700;

/**
 * False while this screen's open transition is still running, then true for
 * good. With `animated` false there is no transition to wait for, so it is
 * true from the start.
 *
 * For holding back heavy rendering until the screen has arrived. Views built
 * during the open run on the same main thread the animation needs, so a list
 * whose data is already cached made every open stutter.
 *
 * Inside a zoom card the card's own open is the transition. Those screens are
 * presented with no native animation, so the navigation's transition end
 * fires at once and says nothing about when the card has grown.
 */
export function useOpenTransitionSettled(animated: boolean) {
    const navigation = useNavigation();
    const zoomOpened = useZoomOpened();
    const [transitionDone, setTransitionDone] = useState(!animated);

    useEffect(() => {
        if (transitionDone || zoomOpened !== null) return;
        const done = () => setTransitionDone(true);
        const unsubscribe = navigation.addListener(
            "transitionEnd" as never,
            done,
        );
        const timer = setTimeout(done, FALLBACK_MS);
        return () => {
            unsubscribe();
            clearTimeout(timer);
        };
    }, [navigation, transitionDone, zoomOpened]);

    if (!animated) return true;
    return zoomOpened ?? transitionDone;
}

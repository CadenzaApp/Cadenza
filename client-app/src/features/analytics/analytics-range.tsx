import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import { resolveRange, type AnalyticsRange, type ResolvedRange } from "./range";

type AnalyticsRangeApi = {
    range: AnalyticsRange;
    setRange: (range: AnalyticsRange) => void;
    /** The window and bucket `range` means, stable between range changes. */
    resolved: ResolvedRange;
};

const AnalyticsRangeContext = createContext<AnalyticsRangeApi | null>(null);

/**
 * The time range every read on the Analytics tab shares.
 *
 * Mounted in the tab's `_layout`, above the stack, so the range survives
 * navigating into a detail page and back.
 *
 * `now` is state, not something read on each render. Resolving the clock per
 * render would give Today a new `since` every time, and the window is part of
 * the SWR key, so every render would be a cache miss and a fresh request. As
 * state it holds still until something moves it: a range change, or the app
 * coming back to the foreground, so an app left open overnight does not keep
 * yesterday's "Today".
 */
export function AnalyticsRangeProvider({ children }: { children: ReactNode }) {
    const [range, setRangeState] = useState<AnalyticsRange>("week");
    const [now, setNow] = useState(() => new Date());

    const refreshClock = useCallback(() => setNow(new Date()), []);

    const setRange = useCallback(
        (next: AnalyticsRange) => {
            refreshClock();
            setRangeState(next);
        },
        [refreshClock],
    );

    useEffect(() => {
        const onChange = (status: AppStateStatus) => {
            if (status === "active") refreshClock();
        };
        const subscription = AppState.addEventListener("change", onChange);
        return () => subscription.remove();
    }, [refreshClock]);

    const resolved = useMemo(() => resolveRange(range, now), [now, range]);

    const api = useMemo(
        () => ({ range, setRange, resolved }),
        [range, resolved, setRange],
    );

    return (
        <AnalyticsRangeContext.Provider value={api}>
            {children}
        </AnalyticsRangeContext.Provider>
    );
}

export function useAnalyticsRange(): AnalyticsRangeApi {
    const api = useContext(AnalyticsRangeContext);
    if (!api) {
        throw new Error(
            "useAnalyticsRange must be used inside an AnalyticsRangeProvider",
        );
    }
    return api;
}

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

import { resolvePeriod, type PeriodGrain, type ResolvedPeriod } from "./range";

type AnalyticsPeriodApi = {
    /** The window, buckets and labels on screen, stable between changes. */
    period: ResolvedPeriod;
    /** Switches grain and jumps back to the current period. */
    setGrain: (grain: PeriodGrain) => void;
    /** Moves `delta` periods. Never past the current one. */
    step: (delta: number) => void;
};

const AnalyticsPeriodContext = createContext<AnalyticsPeriodApi | null>(null);

/**
 * The calendar period every read on the Analytics tab shares.
 *
 * Mounted in the tab's `_layout`, above the stack, so the period survives
 * navigating into a detail page and back.
 *
 * Holds a grain and an offset back from now, not a date, so offset 0 always
 * means the current period.
 *
 * `now` is state, not something read on each render. Resolving the clock per
 * render would move the window every time, and the window is part of the SWR
 * key, so every render would be a cache miss and a fresh request. As state it
 * holds still until something moves it: a change of period, or the app coming
 * back to the foreground, so an app left open overnight does not keep
 * yesterday as "today".
 */
export function AnalyticsPeriodProvider({ children }: { children: ReactNode }) {
    const [grain, setGrainState] = useState<PeriodGrain>("week");
    const [offset, setOffset] = useState(0);
    const [now, setNow] = useState(() => new Date());

    const refreshClock = useCallback(() => setNow(new Date()), []);

    const setGrain = useCallback(
        (next: PeriodGrain) => {
            refreshClock();
            setGrainState(next);
            setOffset(0);
        },
        [refreshClock],
    );

    const step = useCallback(
        (delta: number) => {
            refreshClock();
            setOffset((current) => Math.min(0, current + delta));
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

    const period = useMemo(
        () => resolvePeriod(grain, offset, now),
        [grain, now, offset],
    );

    const api = useMemo(
        () => ({ period, setGrain, step }),
        [period, setGrain, step],
    );

    return (
        <AnalyticsPeriodContext.Provider value={api}>
            {children}
        </AnalyticsPeriodContext.Provider>
    );
}

export function useAnalyticsPeriod(): AnalyticsPeriodApi {
    const api = useContext(AnalyticsPeriodContext);
    if (!api) {
        throw new Error(
            "useAnalyticsPeriod must be used inside an AnalyticsPeriodProvider",
        );
    }
    return api;
}

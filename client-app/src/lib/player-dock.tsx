import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useState,
} from "react";
import type { ReactNode } from "react";
import {
    Easing,
    useSharedValue,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";

/** Tab slots the docked player covers. The bar keeps the first and the last. */
export const DOCKED_PLAYER_SLOTS = 3;

const DOCK_TIMING = { duration: 260, easing: Easing.out(Easing.cubic) };

/**
 * Animates the dock to one end. A plain function rather than a method, so the
 * shared value arrives as an argument and can be written from anywhere that
 * holds it: the provider settles it, the player's drag drives it.
 */
export function settleDock(progress: SharedValue<number>, docked: boolean) {
    progress.value = withTiming(docked ? 1 : 0, DOCK_TIMING);
}

type PlayerDock = {
    /** 0 floating above the bar, 1 docked inside it. Fractional while dragging. */
    progress: SharedValue<number>;
    /** The settled state, for anything that re-renders rather than animates. */
    docked: boolean;
    dock: () => void;
    float: () => void;
    /** Width of the tab bar pill, measured by the bar. */
    barWidth: number;
    /** How many slots the bar divides itself into. */
    tabCount: number;
    setBarMetrics: (metrics: { width: number; tabCount: number }) => void;
};

const PlayerDockContext = createContext<PlayerDock | null>(null);

/**
 * Whether the mini player floats above the tab bar or sits docked inside it.
 * Shared by the two halves that have to agree: the bar, which moves its tabs
 * out of the way, and the player, which moves into the space they leave.
 *
 * It is mounted at the root rather than under the tabs, because the player is
 * mounted outside the navigator.
 */
export function PlayerDockProvider({ children }: { children: ReactNode }) {
    const progress = useSharedValue(0);
    const [docked, setDocked] = useState(false);
    const [bar, setBar] = useState({ width: 0, tabCount: 0 });

    const dock = useCallback(() => {
        setDocked(true);
        settleDock(progress, true);
    }, [progress]);

    const float = useCallback(() => {
        setDocked(false);
        settleDock(progress, false);
    }, [progress]);

    const setBarMetrics = useCallback(
        (metrics: { width: number; tabCount: number }) => {
            setBar((current) =>
                current.width === metrics.width &&
                current.tabCount === metrics.tabCount
                    ? current
                    : metrics,
            );
        },
        [],
    );

    const value = useMemo(
        () => ({
            progress,
            docked,
            dock,
            float,
            barWidth: bar.width,
            tabCount: bar.tabCount,
            setBarMetrics,
        }),
        [progress, docked, dock, float, bar, setBarMetrics],
    );

    return (
        <PlayerDockContext.Provider value={value}>
            {children}
        </PlayerDockContext.Provider>
    );
}

export function usePlayerDock() {
    const dock = useContext(PlayerDockContext);
    if (!dock) {
        throw new Error("usePlayerDock must be used inside PlayerDockProvider");
    }
    return dock;
}

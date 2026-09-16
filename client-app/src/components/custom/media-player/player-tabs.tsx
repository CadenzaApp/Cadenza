import { usePathname } from "expo-router";
import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useState,
    type ReactNode,
} from "react";

import { tabFromPathname, type PlayerTab } from "./player-tab-model";
export { PLAYER_TABS, type PlayerTab } from "./player-tab-model";

type PlayerTabsValue = {
    selectedTab: PlayerTab;
    selectTab: (tab: PlayerTab) => void;
};

const PlayerTabsContext = createContext<PlayerTabsValue | null>(null);

/** Owns the selected page independently of the route used to open the sheet. */
export function PlayerTabsProvider({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const [selectedTab, setSelectedTab] = useState<PlayerTab>(() =>
        tabFromPathname(pathname),
    );
    const selectTab = useCallback((tab: PlayerTab) => setSelectedTab(tab), []);
    const value = useMemo(
        () => ({ selectedTab, selectTab }),
        [selectTab, selectedTab],
    );

    return (
        <PlayerTabsContext.Provider value={value}>
            {children}
        </PlayerTabsContext.Provider>
    );
}

export function usePlayerTabs() {
    const value = useContext(PlayerTabsContext);
    if (!value) {
        throw new Error("usePlayerTabs must be used inside PlayerTabsProvider");
    }
    return value;
}

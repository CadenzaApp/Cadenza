import { createContext, useContext, useMemo, type ReactNode } from "react";

type PlayerChrome = {
    /**
     * Height of the pager's own chrome below the pages, in layout units.
     *
     * The sheet reaches the bottom of the screen, so this is exactly the space
     * between a page's bottom edge and the bottom of the screen - which is the
     * part of a raised keyboard that covers something other than the page.
     */
    bottomChromeHeight: number;
};

const PlayerChromeContext = createContext<PlayerChrome>({
    bottomChromeHeight: 0,
});

/**
 * Lets the pager tell its pages how much room it takes underneath them.
 *
 * A page that lifts content over the keyboard needs that number, and the pager
 * is the only thing that knows it. Measuring it here keeps the pages off
 * screen-coordinate APIs, whose origin inside a presented form sheet is not
 * the origin `useAnimatedKeyboard` reports against.
 */
export function PlayerChromeProvider({
    bottomChromeHeight,
    children,
}: PlayerChrome & { children: ReactNode }) {
    const value = useMemo(() => ({ bottomChromeHeight }), [bottomChromeHeight]);
    return (
        <PlayerChromeContext.Provider value={value}>
            {children}
        </PlayerChromeContext.Provider>
    );
}

export function usePlayerChrome() {
    return useContext(PlayerChromeContext);
}

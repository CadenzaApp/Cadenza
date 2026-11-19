import { createContext, useContext } from "react";

/** Scroll and rail ownership for mounted pages inside a screen-local pager. */
export const ScreenPagerPageContext = createContext<{
    active: boolean;
    topInset?: number;
    keepRailVisible?: boolean;
}>({ active: true });

export function useScreenPagerPage() {
    return useContext(ScreenPagerPageContext);
}

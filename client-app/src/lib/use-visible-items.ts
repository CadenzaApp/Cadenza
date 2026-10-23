import { useMemo } from "react";

import { withoutExplicit, type MaybeExplicit } from "./explicit-filter";
import { useUserSettings } from "./routes/settings";

/** The user's Hide explicit content setting. */
export function useHideExplicit(): boolean {
    return useUserSettings().settings.hide_explicit;
}

/**
 * `items` as the user should see them: without explicit songs and albums when
 * they hide explicit content. Playlists are never rated, so they always stay.
 */
export function useVisibleItems<T extends MaybeExplicit>(items: T[]): T[] {
    const hide = useHideExplicit();
    return useMemo(() => withoutExplicit(items, hide), [items, hide]);
}

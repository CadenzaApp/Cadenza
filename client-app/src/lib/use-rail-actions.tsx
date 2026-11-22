import { useNavigation } from "expo-router";
import { useLayoutEffect } from "react";
import { useScreenPagerPage } from "./screen-pager";

import {
    GlassIconGroup,
    type GlassIconGroupItem,
} from "@/components/ui/glass-icon-group";

/**
 * Puts `items` in the screen's top rail as one glass group, left of the
 * account button. For a body that changes with a switch, like Library's
 * Playlists: only the active pager body sets them. Cleanup clears them when
 * it unmounts or becomes inactive, so the next body starts clean. Pass a stable array, or memoize it.
 */
export function useRailActions(items: GlassIconGroupItem[]) {
    const navigation = useNavigation();
    const { active } = useScreenPagerPage();
    useLayoutEffect(() => {
        if (!active) return;
        navigation.setOptions({
            headerRight: () => <GlassIconGroup items={items} />,
        });
        return () => navigation.setOptions({ headerRight: undefined });
    }, [active, items, navigation]);
}

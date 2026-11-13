import { useNavigation } from "expo-router";
import { useLayoutEffect } from "react";

import {
    GlassIconGroup,
    type GlassIconGroupItem,
} from "@/components/ui/glass-icon-group";

/**
 * Puts `items` in the screen's top rail as one glass group, left of the
 * account button. For a body that changes with a switch, like Library's
 * Playlists: the body on show sets them, and they go when it unmounts, so
 * the next body starts clean. Pass a stable array, or memoize it.
 */
export function useRailActions(items: GlassIconGroupItem[]) {
    const navigation = useNavigation();
    useLayoutEffect(() => {
        navigation.setOptions({
            headerRight: () => <GlassIconGroup items={items} />,
        });
        return () => navigation.setOptions({ headerRight: undefined });
    }, [items, navigation]);
}

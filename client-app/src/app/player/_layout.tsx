import { useState } from "react";
import { playerLayoutKey } from "@/components/custom/media-player/player-tab-model";
import { Slot, usePathname } from "expo-router";

import { PlayerTabsProvider } from "@/components/custom/media-player/player-tabs";
import {
    PlayerScopeProvider,
    usePlayerScope,
} from "@/components/custom/media-player/player-scope";
import { DetailScreen } from "@/components/ui/detail-screen";
import { ZoomSheetSourceScope } from "@/lib/zoom-dismiss";
import { useArtworkTint } from "@/lib/artwork-color";

export default function PlayerLayout() {
    const pathname = usePathname();
    const [key, setKey] = useState(() => playerLayoutKey(pathname));
    const nextKey = playerLayoutKey(pathname, key);
    if (nextKey !== key) setKey(nextKey);
    return (
        <PlayerTabsProvider key={nextKey}>
            <PlayerScopeProvider>
                <ZoomSheetSourceScope>
                    <PlayerSheet />
                </ZoomSheetSourceScope>
            </PlayerScopeProvider>
        </PlayerTabsProvider>
    );
}

function PlayerSheet() {
    const { focusedSong } = usePlayerScope();
    const { tint } = useArtworkTint(focusedSong);

    return (
        <DetailScreen presentation="sheet" title="Now Playing" tint={tint}>
            <Slot />
        </DetailScreen>
    );
}

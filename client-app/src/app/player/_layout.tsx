import { Slot, usePathname } from "expo-router";

import { PlayerTabsProvider } from "@/components/custom/media-player/player-tabs";
import {
    PlayerScopeProvider,
    usePlayerScope,
} from "@/components/custom/media-player/player-scope";
import { DetailScreen } from "@/components/ui/detail-screen";
import { useArtworkTint } from "@/lib/artwork-color";

export default function PlayerLayout() {
    const pathname = usePathname();
    return (
        <PlayerTabsProvider key={pathname}>
            <PlayerScopeProvider>
                <PlayerSheet />
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

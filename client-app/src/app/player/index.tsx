import { PlayerPage } from "@/components/custom/media-player/player-page";
import { usePlayerScope } from "@/components/custom/media-player/player-scope";
import { PlayerTabSwipe } from "@/components/custom/media-player/player-tab-swipe";

export default function PlayerScreen() {
    const { showTagsFor } = usePlayerScope();
    return (
        <PlayerTabSwipe tab="player">
            <PlayerPage onModifyTags={showTagsFor} />
        </PlayerTabSwipe>
    );
}

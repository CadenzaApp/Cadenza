import { TagsPage } from "@/components/custom/media-player/tags-page";
import { usePlayerScope } from "@/components/custom/media-player/player-scope";
import { PlayerTabSwipe } from "@/components/custom/media-player/player-tab-swipe";

export default function TagsScreen() {
    const { focusedSong } = usePlayerScope();
    return (
        <PlayerTabSwipe tab="tags">
            <TagsPage focusedSong={focusedSong} />
        </PlayerTabSwipe>
    );
}

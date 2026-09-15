import { CommentsPage } from "@/components/custom/media-player/comments-page";
import { usePlayerScope } from "@/components/custom/media-player/player-scope";
import { PlayerTabSwipe } from "@/components/custom/media-player/player-tab-swipe";

export default function CommentsScreen() {
    const { focusedSong } = usePlayerScope();
    return (
        <PlayerTabSwipe tab="comments">
            <CommentsPage focusedSong={focusedSong} />
        </PlayerTabSwipe>
    );
}

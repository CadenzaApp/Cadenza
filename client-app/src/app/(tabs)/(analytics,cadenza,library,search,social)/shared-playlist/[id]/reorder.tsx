import { useLocalSearchParams } from "expo-router";

import { SharedPlaylistReorderScreen } from "@/features/shared-playlists/SharedPlaylistReorderScreen";

export default function SharedPlaylistReorderRoute() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const playlistId = Number(Array.isArray(id) ? id[0] : id);
    if (!Number.isFinite(playlistId)) return null;
    return <SharedPlaylistReorderScreen playlistId={playlistId} />;
}

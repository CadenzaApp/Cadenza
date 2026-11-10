import { useLocalSearchParams } from "expo-router";

import { SharedPlaylistMembersScreen } from "@/features/shared-playlists/SharedPlaylistMembersScreen";

export default function SharedPlaylistMembersRoute() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const playlistId = Number(Array.isArray(id) ? id[0] : id);
    if (!Number.isFinite(playlistId)) return null;
    return <SharedPlaylistMembersScreen playlistId={playlistId} />;
}

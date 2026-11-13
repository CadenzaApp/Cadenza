import { Stack, useLocalSearchParams } from "expo-router";

import { SharedPlaylistScreen } from "@/features/shared-playlists/SharedPlaylistScreen";

export default function SharedPlaylistRoute() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const playlistId = Number(Array.isArray(id) ? id[0] : id);
    return (
        <>
            {/* draws its own cover header and back button, like a collection */}
            <Stack.Screen options={{ headerShown: false }} />
            {Number.isFinite(playlistId) ? (
                <SharedPlaylistScreen playlistId={playlistId} />
            ) : null}
        </>
    );
}

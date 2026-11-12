import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    View,
} from "react-native";

import { ErrorNotice } from "@/components/custom/error-notice";
import { GatedFeature } from "@/features/account/gated-feature";
import { classifyError } from "@/lib/app-error";
import { CollectionList } from "@/components/custom/collection-list";
import { Input } from "@/components/ui/input";
import { DetailScreen } from "@/components/ui/detail-screen";
import { GlassPill } from "@/components/ui/glass-pill";
import { Text } from "@/components/ui/text";
import {
    useAddToSharedPlaylist,
    useSharedPlaylists,
} from "@/lib/routes/shared-playlists";
import { usePlaylistMutations, useUserPlaylists } from "@/lib/musickit-hooks";
import type { MusicItem } from "@apple-musickit";
import { logHandledError } from "@/lib/log";

/**
 * Picks a library playlist to add the song to, or makes a new one. Shared
 * playlists the user can edit sit in a row above, for catalog songs only.
 * Opened from the player's options menu with the song in the params, so this
 * screen holds no playback state of its own.
 */
export default function AddToPlaylistScreen() {
    const { songId, title } = useLocalSearchParams<{
        songId: string;
        title?: string;
    }>();
    const router = useRouter();
    const { colors } = useTheme();
    const {
        playlists,
        playlistsLoading,
        playlistsLoadingNextPage,
        hasNextPlaylistPage,
        loadNextPlaylistPage,
        playlistsErr,
    } = useUserPlaylists();
    const { addSongsToPlaylist, createPlaylist } = usePlaylistMutations();
    const { sharedPlaylists } = useSharedPlaylists();
    const { addToSharedPlaylist } = useAddToSharedPlaylist();
    const editableShared = (sharedPlaylists ?? []).filter(
        (p) => p.can.edit_songs,
    );
    // only catalog songs can be shared; a library id means nothing to others
    const shareable = Boolean(songId) && !songId.startsWith("i.");
    const [newPlaylistName, setNewPlaylistName] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const [pendingPlaylistId, setPendingPlaylistId] = useState<string | null>(
        null,
    );

    async function addToExisting(playlist: MusicItem) {
        if (!songId || pendingPlaylistId) return;

        setPendingPlaylistId(playlist.id);
        try {
            await addSongsToPlaylist(playlist.libraryId ?? playlist.id, [
                songId,
            ]);
            router.back();
        } catch (error) {
            logHandledError("Failed to add the song to a playlist", error);
            const { title, detail } = classifyError(error);
            Alert.alert(title, detail);
        } finally {
            setPendingPlaylistId(null);
        }
    }

    async function addToShared(playlistId: number) {
        if (!songId || pendingPlaylistId) return;
        setPendingPlaylistId(`shared:${playlistId}`);
        try {
            await addToSharedPlaylist({
                playlist_id: playlistId,
                song_ids: [songId],
            });
            router.back();
        } catch (error) {
            logHandledError(
                "Failed to add the song to a shared playlist",
                error,
            );
            const { title, detail } = classifyError(error);
            Alert.alert(title, detail);
        } finally {
            setPendingPlaylistId(null);
        }
    }

    async function createAndAdd() {
        const name = newPlaylistName.trim();
        if (!name || !songId || isCreating) return;

        setIsCreating(true);
        try {
            await createPlaylist(name, [songId]);
            router.back();
        } catch (error) {
            logHandledError("Failed to create the playlist", error);
            const { title, detail } = classifyError(error);
            Alert.alert(title, detail);
        } finally {
            setIsCreating(false);
        }
    }

    return (
        <DetailScreen title="Add to Playlist" presentation="sheet">
            <GatedFeature feature="playlists">
                {title ? (
                    <Text
                        className="px-6 pb-2 text-base text-muted-foreground"
                        numberOfLines={1}
                    >
                        {title}
                    </Text>
                ) : null}

                {editableShared.length > 0 ? (
                    <View className="gap-2 pb-3">
                        <Text className="px-6 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                            Shared
                        </Text>
                        {shareable ? (
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerClassName="gap-2 px-6"
                            >
                                {editableShared.map((playlist) => (
                                    <GlassPill
                                        key={playlist.playlist_id}
                                        size="sm"
                                        icon="people-outline"
                                        label={playlist.name}
                                        loading={
                                            pendingPlaylistId ===
                                            `shared:${playlist.playlist_id}`
                                        }
                                        onPress={() =>
                                            void addToShared(
                                                playlist.playlist_id,
                                            )
                                        }
                                    />
                                ))}
                            </ScrollView>
                        ) : (
                            <Text className="px-6 text-sm text-muted-foreground">
                                This song is only in your library, so it
                                can&apos;t go in a shared playlist.
                            </Text>
                        )}
                    </View>
                ) : null}

                {playlistsErr ? <ErrorNotice error={playlistsErr} /> : null}

                <View className="flex-row items-center gap-2 px-6 pb-3">
                    <Input
                        className="flex-1"
                        placeholder="New playlist"
                        value={newPlaylistName}
                        onChangeText={setNewPlaylistName}
                        onSubmitEditing={() => void createAndAdd()}
                        returnKeyType="done"
                    />
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Create playlist and add this song"
                        accessibilityState={{
                            busy: isCreating,
                            disabled: !newPlaylistName.trim(),
                        }}
                        disabled={isCreating || !newPlaylistName.trim()}
                        onPress={() => void createAndAdd()}
                        className={`h-11 w-11 items-center justify-center rounded-full bg-secondary active:opacity-70 ${newPlaylistName.trim() ? "" : "opacity-40"}`}
                    >
                        {isCreating ? (
                            <ActivityIndicator
                                size="small"
                                color={colors.text}
                            />
                        ) : (
                            <Ionicons
                                name="add"
                                size={24}
                                color={colors.text}
                            />
                        )}
                    </Pressable>
                </View>

                <View className="flex-1">
                    <CollectionList
                        collections={playlists}
                        isLoading={playlistsLoading}
                        isLoadingNextPage={playlistsLoadingNextPage}
                        hasNextPage={hasNextPlaylistPage}
                        onLoadNextPage={loadNextPlaylistPage}
                        onSelect={(playlist) => void addToExisting(playlist)}
                        emptyLabel="No playlists in your library yet."
                    />
                </View>
            </GatedFeature>
        </DetailScreen>
    );
}

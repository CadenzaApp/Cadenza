import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";

import { CollectionList } from "@/components/custom/collection-list";
import { Input } from "@/components/ui/input";
import { SheetScreen } from "@/components/ui/sheet-screen";
import { Text } from "@/components/ui/text";
import { getErrorMessage } from "@/lib/error-utils";
import { usePlaylistMutations, useUserPlaylists } from "@/lib/musickit-hooks";
import type { MusicItem } from "@apple-musickit";

/**
 * Picks a library playlist to add the song to, or makes a new one. Opened from
 * the player's options menu with the song in the params, so this screen holds
 * no playback state of its own.
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
            console.error("Failed to add the song to a playlist:", error);
            Alert.alert(
                "Couldn't Add to Playlist",
                getErrorMessage(error) ??
                    "Please check your Apple Music connection and try again.",
            );
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
            console.error("Failed to create the playlist:", error);
            Alert.alert(
                "Couldn't Create Playlist",
                getErrorMessage(error) ??
                    "Please check your Apple Music connection and try again.",
            );
        } finally {
            setIsCreating(false);
        }
    }

    return (
        <SheetScreen title="Add to Playlist">
            {title ? (
                <Text
                    className="px-6 pb-2 text-base text-muted-foreground"
                    numberOfLines={1}
                >
                    {title}
                </Text>
            ) : null}

            {playlistsErr ? (
                <Text className="my-2 px-6 text-center text-destructive">
                    {getErrorMessage(playlistsErr)}
                </Text>
            ) : null}

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
                        <ActivityIndicator size="small" color={colors.text} />
                    ) : (
                        <Ionicons name="add" size={24} color={colors.text} />
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
        </SheetScreen>
    );
}

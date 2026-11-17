import Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem } from "@apple-musickit";
import { useNavigation } from "expo-router";
import { useLayoutEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { ErrorNotice } from "@/components/custom/error-notice";
import { ReorderableList } from "@/components/custom/reorderable-list";
import { RemoteArtwork } from "@/components/ui/remote-artwork";
import { Text } from "@/components/ui/text";
import {
    useSharedPlaylist,
    useSharedPlaylistWrites,
} from "@/lib/routes/shared-playlists";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useAppTheme } from "@/lib/theme";

import { entryIdOf, usePlaylistTracks } from "./use-playlist-tracks";

const ROW_HEIGHT = 60;

/**
 * Drag a shared playlist's songs into a new order. Editors and the owner
 * only. Each drop is one move; other members see it through the socket.
 */
export function SharedPlaylistReorderScreen({
    playlistId,
}: {
    playlistId: number;
}) {
    const navigation = useNavigation();
    const { listBottomInset } = useScreenOverlayInsets();
    const { sharedPlaylist: playlist, sharedPlaylistErr } =
        useSharedPlaylist(playlistId);
    const writes = useSharedPlaylistWrites(playlistId);
    const entries = useMemo(() => playlist?.entries ?? [], [playlist]);
    const { tracks } = usePlaylistTracks(entries);
    const [message, setMessage] = useState<string | null>(null);

    useLayoutEffect(() => {
        navigation.setOptions({ title: "Reorder songs" });
    }, [navigation]);

    /** Moves the song at `from` to where the song at `to` is now. */
    async function move(from: number, to: number) {
        const entryId = tracks[from] ? entryIdOf(tracks[from]) : null;
        const target = tracks[to] ? entryIdOf(tracks[to]) : null;
        // entries Apple Music cannot describe are not rows, so the position
        // comes from the entry the song lands on
        const position = entries.find((e) => e.entry_id === target)?.position;
        if (entryId === null || position === undefined || from === to) return;
        setMessage(null);
        try {
            await writes.moveSong({ entry_id: entryId, position });
        } catch {
            setMessage("Couldn't move that song.");
        }
    }

    if (sharedPlaylistErr && !playlist) {
        return (
            <View className="flex-1 bg-background px-5 pt-4">
                <ErrorNotice error={sharedPlaylistErr} />
            </View>
        );
    }

    const editable = playlist?.can.edit_songs ?? false;

    return (
        <View className="flex-1 bg-background">
            <ReorderableList
                style={{ flex: 1 }}
                contentContainerStyle={{
                    paddingHorizontal: 20,
                    paddingTop: 8,
                    paddingBottom: listBottomInset + 48,
                }}
                header={
                    <View className="gap-2 pb-3">
                        <Text className="text-sm text-muted-foreground">
                            {editable
                                ? "Hold a song, then drag it."
                                : "Only editors can reorder this playlist."}
                        </Text>
                        {message ? (
                            <Text
                                accessibilityRole="alert"
                                className="text-sm text-destructive"
                            >
                                {message}
                            </Text>
                        ) : null}
                    </View>
                }
                empty={
                    <Text className="py-8 text-center text-muted-foreground">
                        No songs yet.
                    </Text>
                }
                data={editable ? tracks : []}
                itemHeight={ROW_HEIGHT}
                keyExtractor={(track) => track.id}
                onReorder={(from, to) => void move(from, to)}
                renderItem={({ item, index }) => (
                    <SongRow
                        track={item}
                        onMoveUp={
                            index > 0
                                ? () => void move(index, index - 1)
                                : undefined
                        }
                        onMoveDown={
                            index < tracks.length - 1
                                ? () => void move(index, index + 1)
                                : undefined
                        }
                    />
                )}
            />
        </View>
    );
}

/** A song and its handle. Screen readers move it with actions instead. */
function SongRow({
    track,
    onMoveUp,
    onMoveDown,
}: {
    track: MusicItem;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
}) {
    const { colors } = useAppTheme();
    const actions = [
        ...(onMoveUp ? [{ name: "moveUp", label: "Move up" }] : []),
        ...(onMoveDown ? [{ name: "moveDown", label: "Move down" }] : []),
    ];
    return (
        <View
            accessible
            accessibilityLabel={`${track.title}, ${track.artistName ?? ""}`}
            accessibilityActions={actions}
            onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === "moveUp") onMoveUp?.();
                if (event.nativeEvent.actionName === "moveDown") onMoveDown?.();
            }}
            className="flex-1 flex-row items-center gap-3"
        >
            <RemoteArtwork
                url={track.artworkUrl}
                className="h-11 w-11 rounded"
            />
            <View className="min-w-0 flex-1">
                <Text
                    className="text-base font-semibold text-foreground"
                    numberOfLines={1}
                >
                    {track.title || "Unknown Title"}
                </Text>
                <Text
                    className="text-sm text-muted-foreground"
                    numberOfLines={1}
                >
                    {track.artistName || "Unknown Artist"}
                </Text>
            </View>
            <Ionicons
                name="reorder-three"
                size={22}
                color={colors.mutedForeground}
            />
        </View>
    );
}

import { useEffect, useState } from "react";
import { View, ActivityIndicator, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MusicKit, MusicItem as AppleMusicItem } from "@apple-musickit";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useTags } from "@/lib/tags";
import { usePlayback } from "@/lib/playback";
import { Tag } from "@/types/tag-types";
import { Text } from "@/components/ui/text";
import { TagPill } from "@/components/custom/tag-pill";
import { MusicList } from "@/components/custom/music-list";

export default function TagDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { tags, songTagsMap, loadSongTags } = useTags();
    const { activeTrackId, isPlaying, togglePlayback } = usePlayback();

    const [tracks, setTracks] = useState<AppleMusicItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const tag = tags.find((t: Tag) => t.id === id);

    useEffect(() => {
        async function load() {
            setIsLoading(true);
            try {
                await Promise.all([
                    MusicKit.getTracksFromLibrary().then((r) => setTracks(r.items || [])),
                    loadSongTags(),
                ]);
            } catch (e) {
                console.error("Failed to load tag detail:", e);
            } finally {
                setIsLoading(false);
            }
        }
        load();
    }, []);

    const taggedTracks = tracks.filter((track) =>
        track.id && (songTagsMap[track.id] ?? []).some((t: Tag) => t.id === id)
    );

    return (
        <View className="flex-1 bg-background">
            {/* Header */}
            <View className="px-6 pt-16 pb-6 border-b border-border">
                <Pressable
                    onPress={() => router.back()}
                    className="flex-row items-center gap-1 mb-6"
                    style={({ pressed }) => pressed ? { opacity: 0.6 } : undefined}
                >
                    <Ionicons name="chevron-back" size={20} color="white" />
                    <Text style={{ color: "white", fontSize: 16 }}>Tags</Text>
                </Pressable>

                {tag ? (
                    <TagPill tag={tag} height={36} />
                ) : (
                    <Text className="text-muted-foreground">Tag not found</Text>
                )}

                <Text className="text-muted-foreground text-sm mt-4">
                    {isLoading ? "Loading..." : `${taggedTracks.length} ${taggedTracks.length === 1 ? "song" : "songs"}`}
                </Text>
            </View>

            {/* Song list */}
            {isLoading ? (
                <View className="flex-1 items-center justify-center">
                    <ActivityIndicator size="large" color={tag?.color ?? "#888888"} />
                </View>
            ) : (
                <MusicList
                    tracks={taggedTracks}
                    isLoading={false}
                    activeTrackId={activeTrackId}
                    isPlaying={isPlaying}
                    onTogglePlayback={togglePlayback}
                    songTagsMap={songTagsMap}
                />
            )}
        </View>
    );
}

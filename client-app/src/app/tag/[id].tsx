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
import { SongDetailModal } from "@/components/custom/song-detail-modal";

export default function TagDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { tags, songTagsMap, loadSongTags, applyTag, removeTag } = useTags();
    const { activeTrackId, isPlaying, togglePlayback } = usePlayback();

    const [tracks, setTracks] = useState<AppleMusicItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedSong, setSelectedSong] = useState<AppleMusicItem | null>(null);
    const [isSongDetailModalOpen, setIsSongDetailModalOpen] = useState(false);

    const tag = tags.find((t: Tag) => t.id === id);

    useEffect(() => {
        async function load() {
            setIsLoading(true);
            try {
                const [libraryResult, map] = await Promise.all([
                    MusicKit.getTracksFromLibrary(),
                    loadSongTags(),
                ]);

                const libraryTracks = libraryResult.items || [];
                const libraryIds = new Set(libraryTracks.map((t) => t.id));

                // Find all song IDs that have this tag
                const taggedSongIds = Object.entries(map)
                    .filter(([, tags]) => tags.some((t: Tag) => t.id === id))
                    .map(([songId]) => songId);

                // Fetch metadata for any tagged songs not already in the library
                const nonLibraryIds = taggedSongIds.filter((songId) => !libraryIds.has(songId));
                const nonLibrarySongs = (
                    await Promise.allSettled(nonLibraryIds.map((songId) => MusicKit.getSongInfo(songId)))
                )
                    .filter((r): r is PromiseFulfilledResult<AppleMusicItem> => r.status === "fulfilled")
                    .map((r) => r.value);

                setTracks([...libraryTracks, ...nonLibrarySongs]);
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

    function handleTrackSelected(track: AppleMusicItem) {
        setSelectedSong(track);
        setIsSongDetailModalOpen(true);
    }

    async function handleApplyTag(tag: Tag) {
        if (!selectedSong?.id) return;
        await applyTag(selectedSong.id, tag);
    }

    async function handleRemoveTag(tag: Tag) {
        if (!selectedSong?.id) return;
        await removeTag(selectedSong.id, tag);
    }

    const selectedSongTags = selectedSong?.id ? (songTagsMap[selectedSong.id] ?? []) : [];

    // Scale the header pill down for longer tag names so it doesn't look weird
    const pillHeight = tag
        ? Math.max(18, 36 - Math.max(0, (tag.name.length - 6) * 1.5))
        : 36;

    return (
        <View className="flex-1 bg-background">
            {/* Header tag pill */}
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
                    <TagPill tag={tag} height={pillHeight} count={isLoading ? undefined : taggedTracks.length} />
                ) : (
                    <Text className="text-muted-foreground">Tag not found</Text>
                )}
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
                    onSelectTrack={handleTrackSelected}
                    songTagsMap={songTagsMap}
                />
            )}

            <SongDetailModal
                open={isSongDetailModalOpen}
                onOpenChange={setIsSongDetailModalOpen}
                song={selectedSong}
                tags={selectedSongTags}
                onTogglePlayback={togglePlayback}
                isThisTrackPlaying={Boolean(
                    selectedSong?.id &&
                    activeTrackId === selectedSong.id &&
                    isPlaying
                )}
                onApplyTag={handleApplyTag}
                onRemoveTag={handleRemoveTag}
            />
        </View>
    );
}

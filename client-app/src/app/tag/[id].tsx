import { useEffect, useState, useMemo } from "react";
import { View, Pressable } from "react-native";
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

/**
 * Custom hook to cleanly fetch exactly the tracks we need.
 */
function useTagTracks(tagId: string, songTagsMap: Record<string, Tag[]>) {
    const [tracks, setTracks] = useState<AppleMusicItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Memoize the exact IDs that belong to this tag
    const taggedSongIds = useMemo(() => {
        return Object.entries(songTagsMap)
            .filter(([, tags]) => tags.some((t) => t.id === tagId))
            .map(([songId]) => songId);
    }, [songTagsMap, tagId]);

    useEffect(() => {
        let isMounted = true;

        async function fetchTracks() {
            if (taggedSongIds.length === 0) {
                if (isMounted) {
                    setTracks([]);
                    setIsLoading(false);
                }
                return;
            }

            setIsLoading(true);
            try {
                const fetchedTracks = await MusicKit.getSongInfo(taggedSongIds);
                if (isMounted) setTracks(fetchedTracks);
            } catch (e) {
                console.error("Failed to load tag detail tracks:", e);
            } finally {
                if (isMounted) setIsLoading(false);
            }
        }

        fetchTracks();

        return () => {
            isMounted = false;
        };
        // We use a joined string dependency so the effect only re-runs if
        // the user actually adds/removes a track from this tag.
    }, [taggedSongIds.join(",")]);

    return { tracks, isLoading, anticipatedCount: taggedSongIds.length };
}

export default function TagDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();

    const { tags, songTagsMap, applyTag, removeTag } = useTags();
    const { activeTrackId, isPlaying, togglePlayback } = usePlayback();
    const { tracks, isLoading, anticipatedCount } = useTagTracks(
        id,
        songTagsMap,
    );

    const [selectedSong, setSelectedSong] = useState<AppleMusicItem | null>(
        null,
    );
    const [isSongDetailModalOpen, setIsSongDetailModalOpen] = useState(false);

    const tag = tags.find((t: Tag) => t.id === id);

    function handleTrackSelected(track: AppleMusicItem) {
        setSelectedSong(track);
        setIsSongDetailModalOpen(true);
    }

    async function handleApplyTag(tag: Tag) {
        if (selectedSong?.id) await applyTag(selectedSong.id, tag);
    }

    async function handleRemoveTag(tag: Tag) {
        if (selectedSong?.id) await removeTag(selectedSong.id, tag);
    }

    const selectedSongTags = selectedSong?.id
        ? (songTagsMap[selectedSong.id] ?? [])
        : [];

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
                    style={({ pressed }) =>
                        pressed ? { opacity: 0.6 } : undefined
                    }
                >
                    <Ionicons name="chevron-back" size={20} color="white" />
                    <Text style={{ color: "white", fontSize: 16 }}>Tags</Text>
                </Pressable>

                {tag ? (
                    <TagPill
                        tag={tag}
                        height={pillHeight}
                        count={anticipatedCount}
                    />
                ) : (
                    <Text className="text-muted-foreground">Tag not found</Text>
                )}
            </View>

            {/* Song list */}
            <MusicList
                tracks={tracks}
                isLoading={isLoading}
                anticipatedTrackCount={anticipatedCount}
                activeTrackId={activeTrackId}
                isPlaying={isPlaying}
                onTogglePlayback={togglePlayback}
                onSelectTrack={handleTrackSelected}
                songTagsMap={songTagsMap}
            />

            <SongDetailModal
                open={isSongDetailModalOpen}
                onOpenChange={setIsSongDetailModalOpen}
                song={selectedSong}
                tags={selectedSongTags}
                onTogglePlayback={togglePlayback}
                isThisTrackPlaying={Boolean(
                    selectedSong?.id &&
                    activeTrackId === selectedSong.id &&
                    isPlaying,
                )}
                onApplyTag={handleApplyTag}
                onRemoveTag={handleRemoveTag}
            />
        </View>
    );
}

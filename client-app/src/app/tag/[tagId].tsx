import { useState } from "react";
import { View, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MusicItem as AppleMusicItem } from "@apple-musickit";
import Ionicons from "@expo/vector-icons/Ionicons";

import { usePlayback } from "@/lib/playback";
import { Text } from "@/components/ui/text";
import { TagPill } from "@/components/custom/tag-pill";
import { MusicList } from "@/components/custom/music-list";
import { SongDetailModal } from "@/components/custom/song-detail-modal";
import { useTag } from "@/lib/routes/tags";
import { useSongInfo } from "@/lib/musickit-hooks";

// needs to be replaced with a hook to get all song ids for a tag,
// then select: to map song ids to AppleMusicItem

export default function TagDetailScreen() {
    const { tagId } = useLocalSearchParams<{ tagId: string }>();
    const {tag, songIds} = useTag(Number(tagId));
    const { songInfo: tracks = [], songInfoLoading: tracksLoading } = useSongInfo(songIds ?? []);

    
    const router = useRouter();

    const { activeTrackId, isPlaying, togglePlayback } = usePlayback();

    const [selectedSong, setSelectedSong] = useState<AppleMusicItem | null>(
        null,
    );
    function handleTrackSelected(track: AppleMusicItem) {
        setSelectedSong(track);
    }

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
                        count={songIds?.length ?? 0}
                    />
                ) : (
                    <Text className="text-muted-foreground">Tag not found</Text>
                )}
            </View>

            {/* Song list */}
            <MusicList
                tracks={tracks}
                isLoading={tracksLoading}
                anticipatedTrackCount={songIds?.length ?? 0}
                activeTrackId={activeTrackId}
                isPlaying={isPlaying}
                onTogglePlayback={togglePlayback}
                onSelectTrack={handleTrackSelected}
            />

            <SongDetailModal
                open={selectedSong != null}
                onClose={() => setSelectedSong(null)}
                song={selectedSong}
                onTogglePlayback={togglePlayback}
                isThisTrackPlaying={Boolean(
                    selectedSong?.id &&
                    activeTrackId === selectedSong.id &&
                    isPlaying,
                )}
            />
        </View>
    );
}

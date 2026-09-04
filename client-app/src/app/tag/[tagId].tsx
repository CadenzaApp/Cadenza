import { View, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Text } from "@/components/ui/text";
import { TagPill } from "@/components/custom/tag-pill";
import { MusicList } from "@/components/custom/music-list";
import { useTag } from "@/lib/routes/tags";
import { useSongInfo } from "@/lib/musickit-hooks";

// needs to be replaced with a hook to get all song ids for a tag,
// then select: to map song ids to AppleMusicItem

export default function TagDetailScreen() {
    const { tagId } = useLocalSearchParams<{ tagId: string }>();
    const { tag, songIds } = useTag(Number(tagId));
    const { songInfo: tracks = [], songInfoLoading: tracksLoading } =
        useSongInfo(songIds ?? []);

    const router = useRouter();

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
            />
        </View>
    );
}

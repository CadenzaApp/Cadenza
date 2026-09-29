import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";

import {
    MusicList,
    type MusicListMultiSelectConfig,
    type MusicListTrackAction,
} from "@/components/custom/music-list";
import { TagPill } from "@/components/custom/tag-pill";
import { DetailScreen } from "@/components/ui/detail-screen";
import { Text } from "@/components/ui/text";
import { useSongInfo } from "@/lib/musickit-hooks";
import { useRemoveTagsFromSongs } from "@/lib/routes/songs";
import { useTag } from "@/lib/routes/tags";

/**
 * One tag and the songs carrying it. Opened from the Tags library sheet, so it
 * is a sheet too.
 */
export default function TagDetailScreen() {
    const { tagId } = useLocalSearchParams<{ tagId: string }>();
    const { tag, songIds } = useTag(Number(tagId));
    const { songInfo: tracks = [], songInfoLoading: tracksLoading } =
        useSongInfo(songIds ?? []);
    const { removeTagsFromSongs } = useRemoveTagsFromSongs();
    const multiSelect = useMemo<MusicListMultiSelectConfig | null>(() => {
        if (!tag) return null;

        return {
            actions: [
                {
                    kind: "apply-tags",
                    label: "Apply other tags",
                    excludedTagIds: [tag.id],
                },
                {
                    kind: "custom",
                    action: {
                        id: `tag:${tag.id}:remove-from-songs`,
                        label: "Remove this tag",
                        icon: "trash-outline",
                        labelColor: "destructive",
                        iconColor: "destructive",
                        onPress: (selectedTracks) =>
                            removeTagsFromSongs({
                                song_ids: selectedTracks.map(
                                    (track) => track.catalogId ?? track.id,
                                ),
                                tag_ids: [tag.id],
                            }),
                    },
                },
                {
                    kind: "add-to-queue",
                },
            ],
        };
    }, [removeTagsFromSongs, tag]);
    const trackMenuActions = useMemo<readonly MusicListTrackAction[]>(() => {
        if (!tag) return [];

        return [
            {
                id: `tag:${tag.id}:remove-from-song`,
                label: "Remove this tag",
                icon: "trash-outline",
                labelColor: "destructive",
                iconColor: "destructive",
                onPress: (track) =>
                    removeTagsFromSongs({
                        song_ids: [track.catalogId ?? track.id],
                        tag_ids: [tag.id],
                    }),
            },
        ];
    }, [removeTagsFromSongs, tag]);

    // Scale the header pill down for longer tag names so it doesn't look weird
    const pillHeight = tag
        ? Math.max(18, 36 - Math.max(0, (tag.name.length - 6) * 1.5))
        : 36;

    return (
        <DetailScreen title={tag?.name ?? "Tag"}>
            <View className="border-b border-border px-6 pb-5">
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

            <View className="flex-1">
                <MusicList
                    tracks={tracks}
                    isLoading={tracksLoading}
                    pagination={null}
                    multiSelect={multiSelect}
                    trackMenuActions={trackMenuActions}
                    fullBleedRows
                    anticipatedTrackCount={songIds?.length ?? 0}
                    mostRelevantTags={tag ? [tag.name] : []}
                />
            </View>
        </DetailScreen>
    );
}

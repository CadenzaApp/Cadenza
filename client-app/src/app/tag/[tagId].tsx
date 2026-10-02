import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { EditTagDialog } from "@/components/custom/edit-tag-dialog";
import { MediaPlayerZoomOverlay } from "@/components/custom/media-player";
import type { MusicListTrackAction } from "@/components/custom/music-list";
import { TagPill } from "@/components/custom/tag-pill";
import {
    type MusicListMultiSelectConfig,
    TrackCollectionView,
    type TrackCollectionOption,
} from "@/components/custom/track-collection-view";
import { FloatingCloseButton } from "@/components/ui/floating-close-button";
import { GlassConfirmDialog } from "@/components/ui/glass-confirm-dialog";
import { useSongInfo } from "@/lib/musickit-hooks";
import { TAG_TYPE_ICONS } from "@/lib/tag-values";
import { useRemoveTagsFromSongs } from "@/lib/routes/songs";
import { useDeleteTag, useTag } from "@/lib/routes/tags";
import type { Tag } from "@/lib/types";
import { useCloseScreen, ZoomDismissScreen } from "@/lib/zoom-dismiss";

const HERO_BUTTON_SIZE = 52;

/** One user tag rendered as a playable, shuffleable collection of its songs. */
export default function TagDetailScreen() {
    return (
        <ZoomDismissScreen overlay={<MediaPlayerZoomOverlay />}>
            <TagDetailCollection />
        </ZoomDismissScreen>
    );
}

function TagDetailCollection() {
    const { tagId } = useLocalSearchParams<{ tagId: string }>();
    const closeScreen = useCloseScreen();
    const { tag, songIds, tagsLoading, tagsErr } = useTag(Number(tagId));
    const {
        songInfo: tracks = [],
        songInfoLoading: tracksLoading,
        songInfoErr: tracksErr,
    } = useSongInfo(songIds ?? []);
    const { removeTagsFromSongs } = useRemoveTagsFromSongs();
    const { deleteTag, deleteTagErr, deleteTagLoading, resetDeleteTag } =
        useDeleteTag();
    const [editMode, setEditMode] = useState<"name" | "color" | null>(null);
    const [deleteOpen, setDeleteOpen] = useState(false);

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
                { kind: "add-to-queue" },
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

    const options = useMemo<readonly TrackCollectionOption[]>(() => {
        if (!tag) return [];

        return [
            {
                id: "rename-tag",
                label: "Rename Tag",
                icon: "pencil-outline",
                onPress: () => setEditMode("name"),
            },
            {
                id: "change-tag-color",
                label: "Change Color",
                icon: "color-palette-outline",
                onPress: () => setEditMode("color"),
            },
            {
                id: "delete-tag",
                label: "Delete Tag",
                icon: "trash-outline",
                destructive: true,
                onPress: () => setDeleteOpen(true),
            },
        ];
    }, [tag]);

    async function confirmDelete() {
        if (!tag || deleteTagLoading) return;
        try {
            await deleteTag({ tag_id: tag.id });
            setDeleteOpen(false);
            closeScreen();
        } catch {
            // The confirm dialog renders deleteTagErr and stays open for retry.
        }
    }

    return (
        <View className="flex-1">
            <TrackCollectionView
                title={tag?.name ?? "Tag"}
                titleContent={
                    tag ? (
                        <TagPill
                            tag={tag}
                            height={24}
                            count={songIds?.length ?? 0}
                            leadingIconName={
                                tag.type === "basic"
                                    ? "pricetag"
                                    : TAG_TYPE_ICONS[tag.type]
                            }
                        />
                    ) : null
                }
                tracks={tracks}
                isLoading={tagsLoading || tracksLoading}
                error={tagsErr ?? tracksErr}
                anticipatedTrackCount={songIds?.length ?? 0}
                multiSelect={multiSelect}
                trackMenuActions={trackMenuActions}
                mostRelevantTags={tag ? [tag.name] : []}
                options={options}
                backgroundColor={tag?.color}
                respectTopSafeArea
                closeControl={
                    <FloatingCloseButton
                        label="Close tag"
                        size={HERO_BUTTON_SIZE}
                    />
                }
            />

            {tag && editMode ? (
                <EditTagDialog
                    key={`${editMode}:${tag.id}`}
                    tag={tag}
                    mode={editMode}
                    onClose={() => setEditMode(null)}
                />
            ) : null}

            <GlassConfirmDialog
                open={deleteOpen}
                title="Delete Tag?"
                description={deleteDescription(tag)}
                confirmLabel="Delete Tag"
                pendingLabel="Deleting..."
                pending={deleteTagLoading}
                error={deleteTagErr ? JSON.stringify(deleteTagErr) : null}
                onOpenChange={(open) => {
                    setDeleteOpen(open);
                    if (!open) resetDeleteTag();
                }}
                onConfirm={() => void confirmDelete()}
            />
        </View>
    );
}

function deleteDescription(tag?: Tag) {
    if (!tag) return "This tag will be removed from every song.";
    return `"${tag.name}" will be removed from every song. This cannot be undone.`;
}

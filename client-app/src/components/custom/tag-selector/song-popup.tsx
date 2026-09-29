import type { MusicItem } from "@apple-musickit";
import {
    ActivityIndicator,
    ScrollView,
    useWindowDimensions,
} from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { useSongTagEditor } from "@/components/custom/song-tag-editor";
import { TagSelector } from "@/components/custom/tag-selector";
import { TagValueDialog } from "@/components/custom/tag-value-dialog";

export function SongTagSelectorPopup({
    track,
    visible,
    onClose,
}: {
    track: MusicItem;
    visible: boolean;
    onClose: () => void;
}) {
    const { width } = useWindowDimensions();
    const songId = track.catalogId ?? track.id;
    const {
        songTags,
        defaultTags,
        editorLoaded,
        suggestedTagsLoading,
        editorError,
        recentTagIds,
        selectTag,
        selectDefaultTag,
        valuePrompt,
        onValueSubmit,
        onValueRemove,
        onValueDialogClose,
        onTagCreated,
    } = useSongTagEditor(songId);
    return (
        <>
            <ModalPopup
                visible={visible}
                onClose={onClose}
                variant="transparent"
                backdropClassName="p-0"
                contentStyle={{
                    width: Math.min(width, width * 0.92 + 24, 624),
                    maxWidth: 624,
                    maxHeight: "60%",
                    padding: 0,
                }}
            >
                <ScrollView
                    contentContainerClassName="gap-4 p-4"
                    showsVerticalScrollIndicator={false}
                >
                    {editorLoaded ? (
                        <TagSelector
                            contextKey={songId}
                            tags={songTags}
                            suggestedTags={defaultTags}
                            suggestedLoading={suggestedTagsLoading}
                            forceVisibleTagIds={recentTagIds}
                            onToggleTag={(tag) => selectTag(tag.id)}
                            onChooseSuggested={(tag) =>
                                selectDefaultTag(tag.id)
                            }
                            onCreateTag={onTagCreated}
                            errorMessage={editorError}
                        />
                    ) : (
                        <ActivityIndicator accessibilityLabel="Loading tags" />
                    )}
                </ScrollView>
            </ModalPopup>

            <TagValueDialog
                open={visible && valuePrompt != null}
                tag={valuePrompt?.tag ?? null}
                initialValue={valuePrompt?.initialValue}
                mode={valuePrompt?.mode ?? "apply"}
                onSubmit={onValueSubmit}
                onRemove={onValueRemove}
                onClose={onValueDialogClose}
            />
        </>
    );
}

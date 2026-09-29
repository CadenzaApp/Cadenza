import type { MusicItem } from "@apple-musickit";
import {
    ActivityIndicator,
    ScrollView,
    useWindowDimensions,
    type LayoutRectangle,
} from "react-native";
import { useState } from "react";

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
    const [popupHeight, setPopupHeight] = useState(0);
    const [yourTagsLayout, setYourTagsLayout] =
        useState<LayoutRectangle | null>(null);
    const songId = track.catalogId ?? track.id;
    const {
        songTags,
        defaultTags,
        editorLoaded,
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
    const yourTagsCenterFromPopupTop = yourTagsLayout
        ? 16 + yourTagsLayout.y + yourTagsLayout.height / 2
        : null;
    const popupTranslateY =
        yourTagsCenterFromPopupTop == null
            ? 0
            : popupHeight / 2 - yourTagsCenterFromPopupTop;
    const geometryReady = popupHeight > 0 && yourTagsCenterFromPopupTop != null;

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
                    opacity: geometryReady ? 1 : 0,
                    transform: [{ translateY: popupTranslateY }],
                }}
            >
                <ScrollView
                    contentContainerClassName="gap-4 p-4"
                    showsVerticalScrollIndicator={false}
                    onLayout={(event) => {
                        const { height } = event.nativeEvent.layout;
                        setPopupHeight((current) =>
                            current === height ? current : height,
                        );
                    }}
                >
                    {editorLoaded ? (
                        <TagSelector
                            contextKey={songId}
                            tags={songTags}
                            suggestedTags={defaultTags}
                            forceVisibleTagIds={recentTagIds}
                            onYourTagsLayout={(layout) =>
                                setYourTagsLayout((current) =>
                                    current?.y === layout.y &&
                                    current?.height === layout.height
                                        ? current
                                        : layout,
                                )
                            }
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

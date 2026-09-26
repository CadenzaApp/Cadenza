import { useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ModalPopup } from "@/components/custom/modal-popup";
import { MusicListActionButton } from "@/components/custom/music-list/music-list-action-button";
import type { MusicListAction } from "@/components/custom/music-list/types";
import { TagSelector } from "@/components/custom/tag-selector";
import { TagValueDialog } from "@/components/custom/tag-value-dialog";
import { Text } from "@/components/ui/text";
import type { Tag } from "@/lib/types";

import { useSongTagEditor } from "../song-tag-editor";
import type { FocusedSong } from "./player-scope";

/** The now-playing sheet's reusable tag selector for the focused song. */
export function TagsPage({ focusedSong }: { focusedSong: FocusedSong }) {
    const insets = useSafeAreaInsets();
    const [menuTag, setMenuTag] = useState<Tag | null>(null);
    const {
        songTags,
        defaultTags,
        editorLoaded,
        recentTagIds,
        selectTag,
        selectDefaultTag,
        removeDefaultTag,
        valuePrompt,
        onValueSubmit,
        onValueRemove,
        onValueDialogClose,
        onTagCreated,
    } = useSongTagEditor(focusedSong.id);

    return (
        <View className="flex-1">
            <ScrollView
                contentContainerClassName="gap-6 px-6 pt-4"
                contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
                showsVerticalScrollIndicator={false}
            >
                <View>
                    <Text className="text-2xl font-bold text-foreground">
                        Tags
                    </Text>
                    <Text
                        className="mt-0.5 text-base text-muted-foreground"
                        numberOfLines={1}
                    >
                        {focusedSong.title}
                    </Text>
                </View>

                {editorLoaded ? (
                    <TagSelector
                        key={focusedSong.id}
                        tags={songTags}
                        suggestedTags={defaultTags}
                        forceVisibleTagIds={recentTagIds}
                        onToggleTag={(tag) => selectTag(tag.id)}
                        onChooseSuggested={(tag) => selectDefaultTag(tag.id)}
                        onDismissSuggested={setMenuTag}
                        onCreateTag={onTagCreated}
                    />
                ) : (
                    <ActivityIndicator accessibilityLabel="Loading tags" />
                )}
            </ScrollView>

            <TagValueDialog
                open={valuePrompt != null}
                tag={valuePrompt?.tag ?? null}
                initialValue={valuePrompt?.initialValue}
                mode={valuePrompt?.mode ?? "apply"}
                onSubmit={onValueSubmit}
                onRemove={onValueRemove}
                onClose={onValueDialogClose}
            />

            <SuggestedTagMenu
                tag={menuTag}
                onRemove={removeDefaultTag}
                onClose={() => setMenuTag(null)}
            />
        </View>
    );
}

/** Long-press action that hides one suggestion for this user and song. */
function SuggestedTagMenu({
    tag,
    onRemove,
    onClose,
}: {
    tag: Tag | null;
    onRemove: (tagId: number) => Promise<void>;
    onClose: () => void;
}) {
    if (!tag) return null;

    const removeAction: MusicListAction<Tag> = {
        id: "remove-suggested-tag",
        label: "Remove this",
        icon: "eye-off-outline",
        onPress: (target) => {
            onClose();
            return onRemove(target.id);
        },
    };

    return (
        <ModalPopup visible onClose={onClose}>
            <MusicListActionButton action={removeAction} target={tag} />
        </ModalPopup>
    );
}

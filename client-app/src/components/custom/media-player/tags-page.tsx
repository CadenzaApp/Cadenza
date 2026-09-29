import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
    FadeIn,
    FadeOut,
    LinearTransition,
} from "react-native-reanimated";

import { ModalPopup } from "@/components/custom/modal-popup";
import { MusicListActionButton } from "@/components/custom/music-list/music-list-action-button";
import type { MusicListAction } from "@/components/custom/music-list/types";
import { TagPill } from "@/components/custom/tag-pill";
import {
    TagSelector,
    TagSelectorPanel,
} from "@/components/custom/tag-selector";
import { TagValueDialog } from "@/components/custom/tag-value-dialog";
import { Text } from "@/components/ui/text";
import { useActivityTagsOnSong } from "@/lib/routes/songs";
import { activityTagDisplayValue, formatTagValue } from "@/lib/tag-values";
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
        editorError,
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
                    <View className="gap-4">
                        <TagSelector
                            contextKey={focusedSong.id}
                            tags={songTags}
                            suggestedTags={defaultTags}
                            forceVisibleTagIds={recentTagIds}
                            onToggleTag={(tag) => selectTag(tag.id)}
                            onChooseSuggested={(tag) =>
                                selectDefaultTag(tag.id)
                            }
                            onDismissSuggested={setMenuTag}
                            onCreateTag={onTagCreated}
                            errorMessage={editorError}
                        />
                        <ActivityTagSection
                            key={focusedSong.id}
                            songId={focusedSong.id}
                        />
                    </View>
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

function ActivityTagSection({ songId }: { songId: string }) {
    const [expanded, setExpanded] = useState(false);
    const { colors } = useTheme();
    const {
        activityTagsOnSong: tags = [],
        activityTagsOnSongLoading: loading,
        activityTagsOnSongErr: error,
    } = useActivityTagsOnSong(expanded ? songId : undefined);

    return (
        <TagSelectorPanel
            heading={
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${expanded ? "Collapse" : "Expand"} activity tags`}
                    accessibilityState={{ expanded }}
                    className="flex-row items-center justify-between active:opacity-70"
                    onPress={() => setExpanded((current) => !current)}
                >
                    <Text className="text-sm font-semibold text-foreground">
                        Activity Tags
                    </Text>
                    <Ionicons
                        name={expanded ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={colors.text}
                    />
                </Pressable>
            }
        >
            {expanded ? (
                <Animated.View
                    className="gap-3"
                    entering={FadeIn.duration(140)}
                    exiting={FadeOut.duration(100)}
                    layout={LinearTransition.duration(160)}
                >
                    {loading ? (
                        <ActivityIndicator accessibilityLabel="Loading activity tags" />
                    ) : error ? (
                        <Text className="text-sm text-muted-foreground">
                            Activity tags are unavailable right now.
                        </Text>
                    ) : (
                        <View className="flex-row flex-wrap gap-2">
                            {tags.map((tag) => (
                                <View
                                    key={tag.id}
                                    accessible
                                    accessibilityLabel={`${tag.name}: ${formatTagValue(tag.type, activityTagDisplayValue(tag))}`}
                                >
                                    <TagPill
                                        tag={tag}
                                        height={14}
                                        value={activityTagDisplayValue(tag)}
                                    />
                                </View>
                            ))}
                        </View>
                    )}
                    <Text className="text-xs text-muted-foreground">
                        Set by what you listen to. You can filter on these in
                        the advanced query builder.
                    </Text>
                </Animated.View>
            ) : null}
        </TagSelectorPanel>
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

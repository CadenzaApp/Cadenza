import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CreateTagDialog } from "@/components/custom/create-tag-dialog";
import { ModalPopup } from "@/components/custom/modal-popup";
import { MusicListActionButton } from "@/components/custom/music-list/music-list-action-button";
import type { MusicListAction } from "@/components/custom/music-list/types";
import { TagPill } from "@/components/custom/tag-pill";
import { TagValueDialog } from "@/components/custom/tag-value-dialog";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import type { Tag } from "@/lib/types";

import { useSongTagEditor, type EditableSongTag } from "../song-tag-editor";
import type { FocusedSong } from "./player-scope";

/**
 * The now-playing sheet's Tags page: every one of the user's tags for the
 * focused song, applied ones first and solid, the rest dimmed, with the song's
 * shared default tags in between as unfilled pills that a tap adopts. Replaces the old
 * stacked-modal tag editor (`TagEditorSheet`) now that Tags is a page of
 * its own rather than something opened over the "..." menu.
 *
 * No artwork and no playback controls. The shared sheet shell paints the
 * gradient behind this page and the other two tabs.
 */
export function TagsPage({ focusedSong }: { focusedSong: FocusedSong }) {
    const insets = useSafeAreaInsets();
    const {
        songTags,
        defaultTags,
        selectTag,
        selectDefaultTag,
        valuePrompt,
        onValueSubmit,
        onValueRemove,
        onValueDialogClose,
        createTagOpen,
        openCreateTag,
        onCreateTagOpenChange,
        onTagCreated,
    } = useSongTagEditor(focusedSong.id);
    const appliedTags = songTags.filter((tag) => tag.applied);
    const availableTags = songTags.filter((tag) => !tag.applied);

    return (
        <View className="flex-1">
            <ScrollView
                contentContainerClassName="gap-6 px-6 pt-4"
                contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
                showsVerticalScrollIndicator={false}
            >
                <View className="flex-row items-center gap-3">
                    <View className="flex-1">
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
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Create a new tag"
                        onPress={openCreateTag}
                        style={({ pressed }) =>
                            pressed ? { opacity: 0.7 } : null
                        }
                    >
                        <View className="h-10 flex-row items-center gap-1 overflow-hidden rounded-full border border-border px-3">
                            <GlassSurface style={StyleSheet.absoluteFill} />
                            <Ionicons name="add" size={18} color="#888888" />
                            <Text className="text-sm font-medium">New</Text>
                        </View>
                    </Pressable>
                </View>

                <TagSection
                    heading="On this song"
                    tags={appliedTags}
                    emptyLabel="No tags on this song yet."
                    onSelectTag={selectTag}
                />
                <DefaultTagSection
                    tags={defaultTags}
                    onSelectTag={selectDefaultTag}
                />
                <TagSection
                    heading="Your other tags"
                    tags={availableTags}
                    emptyLabel="Every tag you have is already on this song."
                    onSelectTag={selectTag}
                />
            </ScrollView>

            <CreateTagDialog
                open={createTagOpen}
                onOpenChange={onCreateTagOpenChange}
                onCreated={onTagCreated}
            />

            <TagValueDialog
                open={valuePrompt != null}
                tag={valuePrompt?.tag ?? null}
                initialValue={valuePrompt?.initialValue}
                mode={valuePrompt?.mode ?? "apply"}
                onSubmit={onValueSubmit}
                onRemove={onValueRemove}
                onClose={onValueDialogClose}
            />
        </View>
    );
}

function TagSection({
    heading,
    tags,
    emptyLabel,
    onSelectTag,
}: {
    heading: string;
    tags: EditableSongTag[];
    emptyLabel: string;
    onSelectTag: (tagId: number) => void;
}) {
    return (
        <View className="gap-2">
            <Text className="text-sm font-medium text-muted-foreground">
                {heading}
            </Text>
            {tags.length === 0 ? (
                <Text className="text-sm text-muted-foreground">
                    {emptyLabel}
                </Text>
            ) : (
                <View className="flex-row flex-wrap gap-2">
                    {tags.map((tag) => (
                        <Pressable
                            key={tag.id}
                            accessibilityRole="button"
                            accessibilityLabel={`${tag.applied ? "Remove" : "Add"} ${tag.name} tag`}
                            accessibilityState={{ selected: tag.applied }}
                            onPress={() => onSelectTag(tag.id)}
                            // Unapplied tags read as available rather than as
                            // absent, so they are dimmed, not restyled.
                            className={
                                tag.applied
                                    ? "active:opacity-70"
                                    : "opacity-45 active:opacity-70"
                            }
                        >
                            <TagPill
                                tag={tag}
                                height={14}
                                value={tag.applied ? tag.value : null}
                            />
                        </Pressable>
                    ))}
                </View>
            )}
        </View>
    );
}

/**
 * The song's shared default tags, unfilled because they belong to everyone
 * rather than to this user. Tapping one copies it into the user's own tags and
 * puts it on the song, so it moves up to "On this song". A long press opens
 * `SuggestedTagMenu` for that pill instead. Nothing shows when the song has
 * none.
 */
function DefaultTagSection({
    tags,
    onSelectTag,
}: {
    tags: Tag[];
    onSelectTag: (tagId: number) => void;
}) {
    const [menuTag, setMenuTag] = useState<Tag | null>(null);

    if (tags.length === 0) return null;

    return (
        <View className="gap-2">
            <Text className="text-sm font-medium text-muted-foreground">
                Suggested tags
            </Text>
            <View className="flex-row flex-wrap gap-2">
                {tags.map((tag) => (
                    <Pressable
                        key={tag.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Add ${tag.name} tag`}
                        onPress={() => onSelectTag(tag.id)}
                        onLongPress={() => setMenuTag(tag)}
                        className="active:opacity-70"
                    >
                        <TagPill tag={tag} height={14} inverted />
                    </Pressable>
                ))}
            </View>

            <SuggestedTagMenu tag={menuTag} onClose={() => setMenuTag(null)} />
        </View>
    );
}

/**
 * The long-press menu on one suggested tag. Same liquid-glass `ModalPopup` the
 * "..." menus use, with one action. Hide suggested tag is a placeholder: it
 * closes the menu and does nothing else until the backend can record it.
 */
function SuggestedTagMenu({
    tag,
    onClose,
}: {
    tag: Tag | null;
    onClose: () => void;
}) {
    if (!tag) return null;

    const hideAction: MusicListAction<Tag> = {
        id: "remove-suggested-tag",
        label: "Remove this",
        icon: "eye-off-outline",
        onPress: onClose,
    };

    return (
        <ModalPopup visible onClose={onClose}>
            <MusicListActionButton action={hideAction} target={tag} />
        </ModalPopup>
    );
}

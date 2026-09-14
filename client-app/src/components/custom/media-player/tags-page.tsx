import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CreateTagDialog } from "@/components/custom/create-tag-dialog";
import { TagPill } from "@/components/custom/tag-pill";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { TintBackdrop } from "@/components/ui/tint-backdrop";
import { useArtworkTint } from "@/lib/artwork-color";

import { useSongTagEditor, type EditableSongTag } from "../song-tag-editor";
import type { FocusedSong } from "./player-pager";

/**
 * The now-playing sheet's Tags page: every one of the user's tags for the
 * focused song, applied ones first and solid, the rest dimmed. Replaces the
 * old stacked-modal tag editor (`TagEditorSheet`) now that Tags is a page of
 * its own rather than something opened over the "..." menu.
 *
 * No artwork, no playback controls - only the gradient wash behind it, same
 * as Comments. That is the Player page's job alone.
 */
export function TagsPage({ focusedSong }: { focusedSong: FocusedSong }) {
    const insets = useSafeAreaInsets();
    const { tint } = useArtworkTint(focusedSong);
    const {
        songTags,
        toggleTag,
        createTagOpen,
        openCreateTag,
        onCreateTagOpenChange,
        onTagCreated,
    } = useSongTagEditor(focusedSong.id);
    const appliedTags = songTags.filter((tag) => tag.applied);
    const availableTags = songTags.filter((tag) => !tag.applied);

    return (
        <View className="flex-1">
            <TintBackdrop tint={tint} />
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
                        style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
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
                    onToggleTag={toggleTag}
                />
                <TagSection
                    heading="Your other tags"
                    tags={availableTags}
                    emptyLabel="Every tag you have is already on this song."
                    onToggleTag={toggleTag}
                />
            </ScrollView>

            <CreateTagDialog
                open={createTagOpen}
                onOpenChange={onCreateTagOpenChange}
                onCreated={onTagCreated}
            />
        </View>
    );
}

function TagSection({
    heading,
    tags,
    emptyLabel,
    onToggleTag,
}: {
    heading: string;
    tags: EditableSongTag[];
    emptyLabel: string;
    onToggleTag: (tagId: number) => void;
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
                            onPress={() => onToggleTag(tag.id)}
                            // Unapplied tags read as available rather than as
                            // absent, so they are dimmed, not restyled.
                            className={
                                tag.applied
                                    ? "active:opacity-70"
                                    : "opacity-45 active:opacity-70"
                            }
                        >
                            <TagPill tag={tag} height={14} />
                        </Pressable>
                    ))}
                </View>
            )}
        </View>
    );
}

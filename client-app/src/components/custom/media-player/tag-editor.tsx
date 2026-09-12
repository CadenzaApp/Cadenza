import Ionicons from "@expo/vector-icons/Ionicons";
import { Modal, Pressable, ScrollView, View } from "react-native";

import { TagPill } from "@/components/custom/tag-pill";
import { Text } from "@/components/ui/text";
import type { Tag } from "@/lib/types";

export type EditableSongTag = Tag & { applied: boolean };

/**
 * Tag the song that is playing. Every tag the user has is a pill: applied ones
 * first and solid, the rest dimmed. Tapping one toggles it.
 *
 * Its own `Modal` rather than a `ModalPopup`, because the popup sizes to its
 * content and the list has to be able to scroll inside a bounded box. A
 * `flex-1` scroll view inside an auto-height parent measures to nothing, which
 * is exactly what this looked like before.
 */
export function MediaPlayerTagEditor({
    songTitle,
    tags,
    onToggleTag,
    onCreateTag,
    onClose,
}: {
    songTitle: string;
    tags: EditableSongTag[];
    onToggleTag: (tagId: number) => void;
    onCreateTag: () => void;
    onClose: () => void;
}) {
    const appliedTags = tags.filter((tag) => tag.applied);
    const availableTags = tags.filter((tag) => !tag.applied);

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose}>
            <Pressable
                className="flex-1 items-center justify-center bg-black/70 px-4 py-8"
                onPress={onClose}
            >
                <Pressable
                    accessibilityViewIsModal
                    onPress={(event) => event.stopPropagation()}
                    className="w-full max-w-[520px] overflow-hidden rounded-xl border border-border bg-popover"
                    style={{ maxHeight: "72%" }}
                >
                    <View className="flex-row items-center gap-3 border-b border-border px-5 py-4">
                        <View className="flex-1">
                            <Text className="text-lg font-semibold text-popover-foreground">
                                Tags
                            </Text>
                            <Text
                                className="mt-0.5 text-sm text-muted-foreground"
                                numberOfLines={1}
                            >
                                {songTitle}
                            </Text>
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Create a new tag"
                            onPress={onCreateTag}
                            className="h-10 flex-row items-center gap-1 rounded-full bg-secondary px-3 active:opacity-70"
                        >
                            <Ionicons name="add" size={18} color="#888888" />
                            <Text className="text-sm font-medium">New</Text>
                        </Pressable>
                    </View>

                    <ScrollView
                        contentContainerClassName="px-5 py-4 gap-5"
                        showsVerticalScrollIndicator={false}
                    >
                        <TagSection
                            heading="On this song"
                            tags={appliedTags}
                            emptyLabel="No tags on this song yet."
                            onToggleTag={onToggleTag}
                        />
                        <TagSection
                            heading="Your other tags"
                            tags={availableTags}
                            emptyLabel="Every tag you have is already on this song."
                            onToggleTag={onToggleTag}
                        />
                    </ScrollView>
                </Pressable>
            </Pressable>
        </Modal>
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

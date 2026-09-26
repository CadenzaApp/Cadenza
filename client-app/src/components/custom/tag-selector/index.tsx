import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { CreateTagDialog } from "@/components/custom/create-tag-dialog";
import { TagPill } from "@/components/custom/tag-pill";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import type { AppliedTag, Tag } from "@/lib/types";

import { visibleTagSelectorItems } from "./sort-tags";

export type TagSelectorItem = AppliedTag & { chosen: boolean };

const DEFAULT_PAGE_SIZE = 20;

export function TagSelector({
    tags,
    suggestedTags,
    onToggleTag,
    onChooseSuggested,
    onDismissSuggested,
    onCreateTag,
    selectionMode = "single",
    forceVisibleTagIds = [],
    pageSize = DEFAULT_PAGE_SIZE,
}: {
    tags: readonly TagSelectorItem[];
    suggestedTags?: readonly Tag[];
    onToggleTag: (tag: TagSelectorItem) => void;
    onChooseSuggested?: (tag: Tag) => void;
    onDismissSuggested?: (tag: Tag) => void;
    onCreateTag: (tag: Tag) => void;
    selectionMode?: "single" | "multiple";
    forceVisibleTagIds?: readonly number[];
    pageSize?: number;
}) {
    const [createTagOpen, setCreateTagOpen] = useState(false);
    const [visibleCount, setVisibleCount] = useState(pageSize);
    const [initialOrder] = useState(() => tags.map((tag) => tag.id));
    const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
    const orderedTags = initialOrder.flatMap((tagId) => {
        const tag = tagsById.get(tagId);
        return tag ? [tag] : [];
    });
    const initiallyKnownIds = new Set(initialOrder);
    orderedTags.push(...tags.filter((tag) => !initiallyKnownIds.has(tag.id)));

    const visibleTags = visibleTagSelectorItems(
        orderedTags,
        visibleCount,
        forceVisibleTagIds,
    );
    const hasMore = visibleCount < orderedTags.length;

    return (
        <View className="gap-4">
            <SelectorCard heading="Your Tags">
                {visibleTags.length ? (
                    <View className="flex-row flex-wrap gap-2">
                        {visibleTags.map((tag) => (
                            <Pressable
                                key={tag.id}
                                accessibilityRole="button"
                                accessibilityLabel={`${tag.chosen ? "Remove" : "Add"} ${tag.name} tag`}
                                accessibilityState={{ selected: tag.chosen }}
                                className="active:opacity-70"
                                onPress={() => onToggleTag(tag)}
                            >
                                <TagPill
                                    tag={tag}
                                    height={14}
                                    value={tag.chosen ? tag.value : null}
                                    appearance={
                                        tag.chosen ? "solid" : "outline"
                                    }
                                />
                            </Pressable>
                        ))}
                    </View>
                ) : (
                    <Text className="text-sm text-muted-foreground">
                        You have no tags yet.
                    </Text>
                )}
                {hasMore ? (
                    <View className="mt-3 items-start">
                        <GlassButton
                            className="h-9 rounded-full px-4"
                            onPress={() =>
                                setVisibleCount((count) => count + pageSize)
                            }
                        >
                            <Text className="text-sm font-medium">
                                Show more
                            </Text>
                        </GlassButton>
                    </View>
                ) : null}
            </SelectorCard>

            {selectionMode === "single" ? (
                <SelectorCard heading="Suggested">
                    {suggestedTags?.length ? (
                        <View className="flex-row flex-wrap gap-2">
                            {suggestedTags.map((tag) => (
                                <Pressable
                                    key={tag.id}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Add suggested ${tag.name} tag`}
                                    className="active:opacity-70"
                                    onPress={() => onChooseSuggested?.(tag)}
                                    onLongPress={
                                        onDismissSuggested
                                            ? () => onDismissSuggested(tag)
                                            : undefined
                                    }
                                >
                                    <TagPill
                                        tag={tag}
                                        height={14}
                                        suggested
                                        leadingIconName="sparkles"
                                    />
                                </Pressable>
                            ))}
                        </View>
                    ) : (
                        <Text className="text-sm text-muted-foreground">
                            No suggestions for this song.
                        </Text>
                    )}
                </SelectorCard>
            ) : null}

            <View className="items-start">
                <GlassButton
                    className="h-10 rounded-full px-4"
                    accessibilityLabel="Create a new tag"
                    onPress={() => setCreateTagOpen(true)}
                >
                    <Ionicons name="add" size={18} color="#888888" />
                    <Text className="text-sm font-medium">New</Text>
                </GlassButton>
            </View>

            <CreateTagDialog
                open={createTagOpen}
                onOpenChange={setCreateTagOpen}
                onCreated={onCreateTag}
            />
        </View>
    );
}

function SelectorCard({
    heading,
    children,
}: {
    heading: string;
    children: ReactNode;
}) {
    return (
        <View className="overflow-hidden rounded-2xl border border-border p-4">
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <GlassSurface style={StyleSheet.absoluteFill} />
            </View>
            <Text className="mb-3 text-sm font-semibold text-foreground">
                {heading}
            </Text>
            {children}
        </View>
    );
}

export type { TagSelectionContext } from "./sort-tags";
export { sortTagSelectorItems } from "./sort-tags";

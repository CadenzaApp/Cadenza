import Ionicons from "@expo/vector-icons/Ionicons";
import { useColorScheme } from "nativewind";
import { useMemo, useState, type ReactNode } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
    type LayoutRectangle,
} from "react-native";

import { CreateTagDialog } from "@/components/custom/create-tag-dialog";
import { TagPill } from "@/components/custom/tag-pill";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import type { AppliedTag, Tag } from "@/lib/types";

import { visibleTagSelectorItems } from "./sort-tags";

export type TagSelectorItem = AppliedTag & { chosen: boolean };

export type TagSelectorFooterAction = {
    id: string;
    label: string;
    onPress: () => void;
    disabled?: boolean;
    variant?: "default" | "destructive";
    accessibilityLabel?: string;
};

const DEFAULT_PAGE_SIZE = 20;
const TAG_ROW_HEIGHT = 24;
const TAG_ROW_GAP = 8;
const MAX_VISIBLE_TAG_ROWS = 6;
const TAG_GRID_MAX_HEIGHT =
    TAG_ROW_HEIGHT * MAX_VISIBLE_TAG_ROWS +
    TAG_ROW_GAP * (MAX_VISIBLE_TAG_ROWS - 1);

type TagSelectorProps = {
    tags: readonly TagSelectorItem[];
    suggestedTags?: readonly Tag[];
    onToggleTag: (tag: TagSelectorItem) => void;
    onChooseSuggested?: (tag: Tag) => void;
    onDismissSuggested?: (tag: Tag) => void;
    /** Omit when this selector must not offer tag creation. */
    onCreateTag?: (tag: Tag) => void;
    /** Liquid-glass actions rendered on the right side of the New button row. */
    footerActions?: readonly TagSelectorFooterAction[];
    loading?: boolean;
    selectionMode?: "single" | "multiple";
    onYourTagsLayout?: (layout: LayoutRectangle) => void;
    forceVisibleTagIds?: readonly number[];
    pageSize?: number;
    emptyLabel?: string;
    /** Changes when this selector starts editing a different logical target. */
    contextKey?: string;
    /** Recoverable mutation failure displayed without dismissing the selector. */
    errorMessage?: string | null;
};

export function TagSelector(props: TagSelectorProps) {
    // The editing target is the lifetime of ordering, pagination, and the New
    // dialog. Make that reset contract explicit here rather than relying on
    // whichever parent happens to render the selector.
    return (
        <TagSelectorSession key={props.contextKey ?? "default"} {...props} />
    );
}

function TagSelectorSession({
    tags,
    suggestedTags,
    onToggleTag,
    onChooseSuggested,
    onDismissSuggested,
    onCreateTag,
    footerActions = [],
    loading = false,
    selectionMode = "single",
    onYourTagsLayout,
    forceVisibleTagIds = [],
    pageSize = DEFAULT_PAGE_SIZE,
    emptyLabel = "You have no tags yet.",
    errorMessage,
}: TagSelectorProps) {
    const { colorScheme } = useColorScheme();
    const newButtonTint = THEME[colorScheme === "dark" ? "dark" : "light"].card;
    const [createTagOpen, setCreateTagOpen] = useState(false);
    const [visibleCount, setVisibleCount] = useState(pageSize);
    const [initialOrder] = useState(() => tags.map((tag) => tag.id));
    const orderedTags = useMemo(() => {
        const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
        const ordered = initialOrder.flatMap((tagId) => {
            const tag = tagsById.get(tagId);
            return tag ? [tag] : [];
        });
        const initiallyKnownIds = new Set(initialOrder);
        ordered.push(...tags.filter((tag) => !initiallyKnownIds.has(tag.id)));
        return ordered;
    }, [initialOrder, tags]);

    const visibleTags = visibleTagSelectorItems(
        orderedTags,
        visibleCount,
        forceVisibleTagIds,
    );
    const hasMore = visibleCount < orderedTags.length;

    return (
        <View className="gap-4">
            <TagSelectorPanel heading="Your Tags" onLayout={onYourTagsLayout}>
                {loading ? (
                    <ActivityIndicator accessibilityLabel="Loading tags" />
                ) : visibleTags.length ? (
                    <ScrollView
                        nestedScrollEnabled
                        showsVerticalScrollIndicator
                        style={{ maxHeight: TAG_GRID_MAX_HEIGHT }}
                    >
                        <View className="flex-row flex-wrap gap-2">
                            {visibleTags.map((tag) => (
                                <Pressable
                                    key={tag.id}
                                    accessibilityRole="button"
                                    accessibilityLabel={
                                        selectionMode === "multiple"
                                            ? `${tag.chosen ? "Deselect" : "Select"} ${tag.name} tag`
                                            : `${tag.chosen ? "Remove" : "Add"} ${tag.name} tag`
                                    }
                                    accessibilityState={{
                                        selected: tag.chosen,
                                    }}
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
                    </ScrollView>
                ) : (
                    <Text className="text-sm text-muted-foreground">
                        {emptyLabel}
                    </Text>
                )}
                {!loading && hasMore ? (
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
            </TagSelectorPanel>

            {selectionMode === "single" ? (
                <TagSelectorPanel heading="Suggested">
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
                </TagSelectorPanel>
            ) : null}

            {onCreateTag || footerActions.length ? (
                <View className="flex-row items-center gap-2">
                    {onCreateTag ? (
                        <GlassButton
                            className="h-10 rounded-full px-4"
                            glassTintColor={newButtonTint}
                            accessibilityLabel="Create a new tag"
                            onPress={() => setCreateTagOpen(true)}
                        >
                            <Ionicons name="add" size={18} color="#888888" />
                            <Text className="text-sm font-medium">New</Text>
                        </GlassButton>
                    ) : null}

                    {footerActions.length ? (
                        <View className="ml-auto flex-row items-center gap-2">
                            {footerActions.map((action) => (
                                <GlassButton
                                    key={action.id}
                                    className="h-10 rounded-full px-4"
                                    glassTintColor={newButtonTint}
                                    variant={action.variant}
                                    accessibilityLabel={
                                        action.accessibilityLabel ??
                                        action.label
                                    }
                                    disabled={action.disabled}
                                    onPress={action.onPress}
                                >
                                    <Text className="text-sm font-medium">
                                        {action.label}
                                    </Text>
                                </GlassButton>
                            ))}
                        </View>
                    ) : null}
                </View>
            ) : null}

            {onCreateTag ? (
                <CreateTagDialog
                    open={createTagOpen}
                    onOpenChange={setCreateTagOpen}
                    onCreated={onCreateTag}
                />
            ) : null}

            {errorMessage ? (
                <Text className="text-sm text-destructive">{errorMessage}</Text>
            ) : null}
        </View>
    );
}

export function TagSelectorPanel({
    heading,
    children,
    onLayout,
}: {
    heading: ReactNode;
    children: ReactNode;
    onLayout?: (layout: LayoutRectangle) => void;
}) {
    return (
        <View
            className="overflow-hidden rounded-2xl border border-border p-4"
            onLayout={(event) => onLayout?.(event.nativeEvent.layout)}
        >
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <GlassSurface style={StyleSheet.absoluteFill} />
            </View>
            {typeof heading === "string" ? (
                <Text
                    className={`${children == null ? "" : "mb-3 "}text-sm font-semibold text-foreground`}
                >
                    {heading}
                </Text>
            ) : (
                <View className={children == null ? undefined : "mb-3"}>
                    {heading}
                </View>
            )}
            {children}
        </View>
    );
}

export type { TagSelectionContext } from "./sort-tags";
export { sortTagSelectorItems } from "./sort-tags";

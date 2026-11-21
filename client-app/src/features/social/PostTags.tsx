import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import {
    Pressable,
    StyleSheet,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { TagColorPicker } from "@/components/custom/tag-color-picker";
import { DialogCloseButton } from "@/components/ui/dialog-close-button";
import { Text } from "@/components/ui/text";
import { withAlpha } from "@/lib/artwork-color";
import { TAG_COLOR_OPTIONS } from "@/lib/tag-color-palette";
import { useAppTheme } from "@/lib/theme";
import type { SocialPostTag } from "@/lib/types";

export const MAX_POST_TAGS = 10;
export const POST_TAG_TEXT_MAX = 24;

/** A color from the tag picker's preset palette. */
export function randomPostTagColor(): string {
    const index = Math.floor(Math.random() * TAG_COLOR_OPTIONS.length);
    return TAG_COLOR_OPTIONS[index];
}

const COLOR_DIALOG_PADDING = 24;
const COLOR_DIALOG_MARGIN = 20;

/** A tag being composed or edited. `tag_id` is absent until the server assigns one. */
export type DraftPostTag = {
    tag_id?: number;
    text: string;
    color: string;
};

export function draftTagsFromPost(
    tags: SocialPostTag[] | undefined,
): DraftPostTag[] {
    return (tags ?? []).map((tag) => ({
        tag_id: tag.tag_id,
        text: tag.text,
        color: tag.color,
    }));
}

/** Collapses whitespace the same way the server stores a tag. */
export function normalizePostTagText(raw: string): string {
    return raw.trim().split(/\s+/).filter(Boolean).join(" ");
}

function tagForeground(hex: string): string {
    const red = Number.parseInt(hex.slice(1, 3), 16);
    const green = Number.parseInt(hex.slice(3, 5), 16);
    const blue = Number.parseInt(hex.slice(5, 7), 16);
    if ([red, green, blue].some((channel) => Number.isNaN(channel))) {
        return "#ffffff";
    }
    const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
    return luminance > 150 ? "#111111" : "#ffffff";
}

/**
 * The tags already on a draft, in a wrapping row, then the field that adds
 * one. Tapping a tag opens a color modal. The x beside it removes it.
 */
export function PostTagFields({
    tags,
    onChange,
    disabled = false,
}: {
    tags: DraftPostTag[];
    onChange: (tags: DraftPostTag[]) => void;
    disabled?: boolean;
}) {
    const { mutedForeground } = useAppTheme().colors;
    const { width: screenWidth } = useWindowDimensions();
    const [draft, setDraft] = useState("");
    const [colorIndex, setColorIndex] = useState<number | null>(null);
    const colorTag = colorIndex == null ? null : tags[colorIndex];
    const dialogWidth = Math.min(screenWidth - COLOR_DIALOG_MARGIN * 2, 360);

    function addTag() {
        const text = normalizePostTagText(draft);
        if (
            !text ||
            text.length > POST_TAG_TEXT_MAX ||
            tags.length >= MAX_POST_TAGS
        ) {
            return;
        }
        const word = text.toLowerCase();
        if (tags.some((tag) => tag.text.toLowerCase() === word)) return;
        onChange([...tags, { text, color: randomPostTagColor() }]);
        setDraft("");
    }

    function removeTag(index: number) {
        onChange(tags.filter((_, tagIndex) => tagIndex !== index));
        if (colorIndex === index) setColorIndex(null);
    }

    return (
        <View className="mt-2 gap-3">
            <Text className="text-sm font-semibold leading-none">Tags</Text>
            {tags.length > 0 ? (
                <View className="flex-row flex-wrap gap-2">
                    {tags.map((tag, index) => (
                        <View
                            key={tag.tag_id ?? `new-${index}-${tag.text}`}
                            className="flex-row items-center gap-1"
                        >
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Change color of ${tag.text}`}
                                disabled={disabled}
                                onPress={() => setColorIndex(index)}
                                className="rounded-full px-3 py-1 active:opacity-70"
                                style={{ backgroundColor: tag.color }}
                            >
                                <Text
                                    className="text-sm font-medium"
                                    style={{ color: tagForeground(tag.color) }}
                                >
                                    {tag.text}
                                </Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Remove ${tag.text}`}
                                disabled={disabled}
                                hitSlop={8}
                                onPress={() => removeTag(index)}
                                className="active:opacity-60"
                            >
                                <Ionicons
                                    name="close"
                                    size={16}
                                    color={mutedForeground}
                                />
                            </Pressable>
                        </View>
                    ))}
                </View>
            ) : null}
            <View
                className="overflow-hidden rounded-full"
                style={{
                    borderWidth: StyleSheet.hairlineWidth * 2,
                    borderColor: withAlpha(mutedForeground, 0.55),
                }}
            >
                <TextInput
                    value={draft}
                    onChangeText={(text) =>
                        setDraft(text.slice(0, POST_TAG_TEXT_MAX))
                    }
                    onSubmitEditing={addTag}
                    placeholder={
                        tags.length >= MAX_POST_TAGS
                            ? "10 tags is the limit"
                            : "Add a tag"
                    }
                    placeholderTextColor={mutedForeground}
                    returnKeyType="done"
                    editable={!disabled && tags.length < MAX_POST_TAGS}
                    autoCorrect={false}
                    className="h-11 px-3 text-foreground"
                    style={{ fontSize: 16, paddingVertical: 0 }}
                />
            </View>
            <ModalPopup
                visible={colorTag != null}
                onClose={() => setColorIndex(null)}
                contentStyle={{
                    width: dialogWidth,
                    maxWidth: dialogWidth,
                    padding: COLOR_DIALOG_PADDING,
                }}
            >
                <DialogCloseButton
                    onPress={() => setColorIndex(null)}
                    accessibilityLabel="Close tag color"
                />
                <Text className="mb-4 pr-6 text-lg font-semibold leading-none">
                    Tag color
                </Text>
                {colorTag ? (
                    <TagColorPicker
                        width={dialogWidth - COLOR_DIALOG_PADDING * 2}
                        selectedColor={colorTag.color}
                        onSelectColor={(color) => {
                            if (colorIndex == null) return;
                            onChange(
                                tags.map((tag, index) =>
                                    index === colorIndex
                                        ? { ...tag, color }
                                        : tag,
                                ),
                            );
                        }}
                    />
                ) : null}
            </ModalPopup>
        </View>
    );
}

/** Read-only tags on a post card. */
/**
 * A post's tags as colored pills. `compact` is one smaller row that clips
 * rather than wraps, for laying over a spotlight cover.
 */
export function PostTagRow({
    tags,
    compact = false,
}: {
    tags: SocialPostTag[] | undefined;
    compact?: boolean;
}) {
    if (!tags || tags.length === 0) return null;
    return (
        <View
            className={
                compact
                    ? "flex-row gap-1.5 overflow-hidden"
                    : "flex-row flex-wrap gap-2"
            }
        >
            {tags.map((tag) => (
                <View
                    key={tag.tag_id}
                    className={
                        compact
                            ? "shrink-0 rounded-full px-2.5 py-0.5"
                            : "rounded-full px-3 py-1"
                    }
                    style={{ backgroundColor: tag.color }}
                >
                    <Text
                        className={
                            compact
                                ? "text-xs font-medium"
                                : "text-sm font-medium"
                        }
                        numberOfLines={compact ? 1 : undefined}
                        style={{ color: tagForeground(tag.color) }}
                    >
                        {tag.text}
                    </Text>
                </View>
            ))}
        </View>
    );
}

/** The edit request for tags the author changed. Untouched tags are omitted. */
export function postTagPatch(
    original: SocialPostTag[] | undefined,
    draft: DraftPostTag[],
) {
    const stored = original ?? [];
    const kept = new Set(
        draft.flatMap((tag) => (tag.tag_id == null ? [] : [tag.tag_id])),
    );
    const remove = stored
        .filter((tag) => !kept.has(tag.tag_id))
        .map((tag) => tag.tag_id);
    const edit: Record<string, { text: string; color: string }> = {};
    for (const tag of draft) {
        if (tag.tag_id == null) continue;
        const previous = stored.find((item) => item.tag_id === tag.tag_id);
        if (!previous) continue;
        if (previous.text !== tag.text || previous.color !== tag.color) {
            edit[String(tag.tag_id)] = { text: tag.text, color: tag.color };
        }
    }
    const add = draft
        .filter((tag) => tag.tag_id == null)
        .map((tag) => ({ text: tag.text, color: tag.color }));
    return {
        ...(Object.keys(edit).length > 0 ? { edit } : {}),
        ...(remove.length > 0 ? { delete: remove } : {}),
        ...(add.length > 0 ? { add } : {}),
    };
}

import { Pressable, ScrollView, View } from "react-native";

import { Text } from "@/components/ui/text";
import { formatTagValue, isAttributeTag } from "@/lib/tag-values";
import type { AppliedTag } from "@/lib/types";

export type EditableSongTag = AppliedTag & { applied: boolean };

export function MediaPlayerTagEditor({
    width,
    tags,
    onSelectTag,
}: {
    width: number;
    tags: EditableSongTag[];
    /**
     * Basic tags are toggled on and off. Attribute tags open an editor for
     * their value, so the caller decides what a press does.
     */
    onSelectTag: (tagId: number) => void;
}) {
    return (
        <View style={{ width }} className="pl-1">
            <Text className="text-xl font-bold text-foreground">Edit tags</Text>
            <ScrollView
                className="flex-1 mt-3"
                contentContainerClassName="flex-row flex-wrap gap-2 pb-2"
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
            >
                {tags.map((tag) => {
                    const displayedValue = tag.applied
                        ? formatTagValue(tag.type, tag.value)
                        : "";

                    return (
                        <Pressable
                            key={tag.id}
                            accessibilityRole="button"
                            accessibilityLabel={
                                isAttributeTag(tag.type)
                                    ? `${tag.applied ? "Edit" : "Add"} ${tag.name} tag value`
                                    : `${tag.applied ? "Remove" : "Add"} ${tag.name} tag`
                            }
                            accessibilityState={{ selected: tag.applied }}
                            onPress={() => onSelectTag(tag.id)}
                            className="rounded-full px-3 py-2 border flex-row items-center gap-1.5"
                            style={{
                                borderColor: tag.color,
                                backgroundColor: tag.applied
                                    ? tag.color
                                    : "transparent",
                            }}
                        >
                            <Text
                                className="text-sm font-medium"
                                style={{
                                    color: tag.applied ? "#ffffff" : tag.color,
                                }}
                            >
                                {tag.name}
                            </Text>
                            {displayedValue !== "" && (
                                <Text
                                    numberOfLines={1}
                                    className="text-sm"
                                    style={{
                                        color: tag.applied
                                            ? "#ffffff"
                                            : tag.color,
                                        opacity: 0.75,
                                        maxWidth: 160,
                                    }}
                                >
                                    {displayedValue}
                                </Text>
                            )}
                        </Pressable>
                    );
                })}
            </ScrollView>
        </View>
    );
}

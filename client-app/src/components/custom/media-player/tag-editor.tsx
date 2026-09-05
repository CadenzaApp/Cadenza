import { Pressable, ScrollView, View } from "react-native";

import { Text } from "@/components/ui/text";
import type { Tag } from "@/lib/types";

export type EditableSongTag = Tag & { applied: boolean };

export function MediaPlayerTagEditor({
    width,
    tags,
    onToggleTag,
}: {
    width: number;
    tags: EditableSongTag[];
    onToggleTag: (tagId: number) => void;
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
                {tags.map((tag) => (
                    <Pressable
                        key={tag.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${tag.applied ? "Remove" : "Add"} ${tag.name} tag`}
                        accessibilityState={{ selected: tag.applied }}
                        onPress={() => onToggleTag(tag.id)}
                        className="rounded-full px-3 py-2 border"
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
                    </Pressable>
                ))}
            </ScrollView>
        </View>
    );
}

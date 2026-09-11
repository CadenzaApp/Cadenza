import { useRouter } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";

import { CreateTagDialog } from "@/components/custom/create-tag-dialog";
import { TagPill } from "@/components/custom/tag-pill";
import { Text } from "@/components/ui/text";
import type { Tag, TagMetadata } from "@/lib/types";

type Props = {
    tags?: Tag[];
    metadata?: Record<number, TagMetadata>;
    isLoading: boolean;
    error?: unknown;
};

export function TagsView({ tags, metadata, isLoading, error }: Props) {
    const router = useRouter();

    return (
        <View className="flex-1 bg-background">
            <ScrollView
                className="flex-1"
                contentContainerClassName="px-4 pt-4"
                showsVerticalScrollIndicator={false}
            >
                <View className="mb-2">
                    <Text variant="h2" className="mb-1 border-b-0">
                        Your Tags
                    </Text>
                    <Text className="mb-5 text-lg text-muted-foreground">
                        {tags?.length ?? "?"}{" "}
                        {tags?.length === 1 ? "tag" : "tags"}
                    </Text>
                </View>

                {error ? (
                    <Text className="mb-3 text-sm text-destructive">
                        {JSON.stringify(error)}
                    </Text>
                ) : null}

                {isLoading ? (
                    <Text className="text-lg text-muted-foreground">
                        Loading...
                    </Text>
                ) : (
                    <View className="flex-row flex-wrap gap-2.5">
                        {tags?.map((tag) => (
                            <Pressable
                                key={tag.id}
                                onPress={() =>
                                    router.push({
                                        pathname: "/tag/[tagId]",
                                        params: { tagId: tag.id },
                                    })
                                }
                                style={({ pressed }) =>
                                    pressed ? { opacity: 0.7 } : undefined
                                }
                            >
                                <TagPill
                                    tag={tag}
                                    height={14}
                                    count={metadata?.[tag.id]?.count}
                                />
                            </Pressable>
                        ))}
                    </View>
                )}
            </ScrollView>

            <CreateTagDialog />
        </View>
    );
}

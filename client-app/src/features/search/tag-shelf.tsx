import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";

import { readableTextColor } from "@/components/custom/tag-pill";
import { Text } from "@/components/ui/text";
import { useUserTags } from "@/lib/routes/tags";

const TILE_HEIGHT = 72;

/**
 * The user's tags as a two-up grid of colored tiles. This is the slot Apple
 * fills with browse categories. We have no catalog to browse, so we surface
 * the one set of collections that is actually ours.
 */
export function TagShelf() {
    const router = useRouter();
    const { userTags, userTagsMeta, userTagsLoading } = useUserTags();

    if (userTagsLoading || !userTags || userTags.length === 0) return null;

    return (
        <View className="pt-4">
            <Text className="px-5 pb-2 text-lg font-bold">Your Tags</Text>

            <View className="flex-row flex-wrap justify-between gap-y-3 px-5">
                {userTags.map((tag) => {
                    const textColor = readableTextColor(tag.color);
                    const count = userTagsMeta?.[tag.id]?.count ?? 0;

                    return (
                        <Pressable
                            key={tag.id}
                            accessibilityRole="button"
                            accessibilityLabel={`Open tag ${tag.name}`}
                            onPress={() => router.push(`/tag/${tag.id}`)}
                            // Two per row, sharing the gap between them.
                            style={{
                                height: TILE_HEIGHT,
                                backgroundColor: tag.color,
                            }}
                            className="w-[48%] justify-end rounded-2xl p-3 active:opacity-80"
                        >
                            <Text
                                className="text-base font-semibold leading-tight"
                                style={{ color: textColor }}
                                numberOfLines={1}
                            >
                                {tag.name}
                            </Text>
                            <Text
                                className="text-xs leading-tight opacity-80"
                                style={{ color: textColor }}
                            >
                                {count === 1 ? "1 song" : `${count} songs`}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

import { useRouter } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";

import { CreateTagBubble } from "@/components/custom/create-tag-dialog";
import { TagPill } from "@/components/custom/tag-pill";
import { Text } from "@/components/ui/text";
import { useUserTags } from "@/lib/routes/tags";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";

/**
 * Every tag the user has, as pills that open the tag's songs. Fetches its own
 * tags rather than taking them as props, because its only caller is the Tags
 * library sheet. SWR dedupes against anyone else reading the same list.
 */
export function TagsView() {
    const router = useRouter();
    const {
        userTags: tags,
        userTagsMeta: metadata,
        userTagsLoading: isLoading,
        userTagsErr: error,
    } = useUserTags();
    // The create-tag bubble floats over this list, and so do both bottom bars.
    const { listBottomInset } = useScreenOverlayInsets();

    return (
        <View className="flex-1">
            <ScrollView
                className="flex-1"
                // One source for the content padding. Splitting it across
                // `contentContainerClassName` and `contentContainerStyle`
                // leaves two things to keep in sync for no gain.
                contentContainerStyle={{
                    paddingHorizontal: 16,
                    paddingTop: 16,
                    paddingBottom: listBottomInset,
                }}
                showsVerticalScrollIndicator={false}
            >
                <Text className="mb-5 text-lg text-muted-foreground">
                    {tags?.length ?? "?"} {tags?.length === 1 ? "tag" : "tags"}
                </Text>

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

            <CreateTagBubble />
        </View>
    );
}

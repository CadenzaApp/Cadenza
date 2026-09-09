import { useAccount } from "@/lib/account";
import { useTags } from "@/lib/routes/tags";
import { Redirect, useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { TagPill } from "@/components/custom/tag-pill";
import { CreateTagDialog } from "@/components/custom/create-tag-dialog";
import { ScrollView, View, Pressable } from "react-native";

export default function TagsScreen() {
    const router = useRouter();
    const { account } = useAccount();
    const { tagsWithMeta, tagsLoading, tagsErr } = useTags();

    if (!account) return <Redirect href="/auth?initialMode=signin" />;

    return (
        <View className="flex-1 bg-background">
            <View className="flex-1 px-4 pt-14">
                <ScrollView showsVerticalScrollIndicator={false}>
                    <View className="mb-2">
                        <Text variant="h2" className="border-b-0 mb-1">
                            Your Tags
                        </Text>
                        <Text className="text-muted-foreground text-lg mb-5">
                            {tagsWithMeta?.length ?? "?"}{" "}
                            {tagsWithMeta?.length === 1 ? "tag" : "tags"}
                        </Text>
                    </View>

                    {tagsErr && (
                        <Text className="text-destructive text-sm mb-3">
                            {JSON.stringify(tagsErr)}
                        </Text>
                    )}

                    {tagsLoading ? (
                        <Text className="text-muted-foreground text-lg">
                            Loading...
                        </Text>
                    ) : (
                        <View className="flex-row flex-wrap gap-2.5">
                            {tagsWithMeta?.map(({ tag, count }) => (
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
                                        count={count}
                                    />
                                </Pressable>
                            ))}
                        </View>
                    )}
                </ScrollView>
            </View>

            <CreateTagDialog />
        </View>
    );
}

import { useAccount } from "@/lib/account";
import { useLocalTags } from "@/lib/routes/tags";
import { Redirect, useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { TagPill } from "@/components/custom/tag-pill";
import { CreateTagDialog } from "@/components/custom/create-tag-dialog";
import { ScrollView, View, Pressable } from "react-native";

export default function TagsScreen() {
    const router = useRouter();
    const { account } = useAccount();
    const { data, isLoading, error } = useLocalTags();

    if (!account) return <Redirect href="/auth?initialMode=signin" />;

    return (
        <View className="flex-1 bg-background px-4 pt-14">
            <ScrollView showsVerticalScrollIndicator={false}>
                <View className="mb-2">
                    <Text variant="h2" className="border-b-0 mb-1">
                        Your Tags
                    </Text>
                    <Text className="text-muted-foreground text-lg mb-5">
                        {data.length} {data.length === 1 ? "tag" : "tags"}
                    </Text>
                </View>

                {error && (
                    <Text className="text-destructive text-sm mb-3">
                        {error}
                    </Text>
                )}

                {isLoading ? (
                    <Text className="text-muted-foreground text-lg">
                        Loading...
                    </Text>
                ) : (
                    <View className="flex-row flex-wrap gap-2.5">
                        {data.map(({tag, count}) => (
                            <Pressable
                                key={tag.id}
                                onPress={() =>
                                    router.push({
                                        pathname: "/tag/[id]",
                                        params: { id: tag.id },
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

            <CreateTagDialog />
        </View>
    );
}

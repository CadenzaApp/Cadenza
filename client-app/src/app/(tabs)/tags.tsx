import { useAccount } from "@/lib/account";
import { useTags } from "@/lib/tags";
import { Redirect } from "expo-router";
import { Text } from "@/components/ui/text";
import { TagPill } from "@/components/custom/tag-pill";
import { CreateTagDialog } from "@/components/custom/create-tag-dialog";
import { ScrollView, View } from "react-native";
import { Tag } from "@/lib/types";

export default function TagsScreen() {
    const { account } = useAccount();
    const { tags, loading: loadingTags, error: fetchError, addTag } = useTags();

    if (!account) return <Redirect href="/auth?initialMode=signin" />;

    function handleTagCreated(newTag: Tag) {
        addTag(newTag);
    }

    return (
        <View className="flex-1 bg-background px-4 pt-14">
            <ScrollView showsVerticalScrollIndicator={false}>
                <View className="mb-2">
                    <Text variant="h2" className="border-b-0 mb-1">
                        Your Tags
                    </Text>
                    <Text className="text-muted-foreground text-lg mb-5">
                        {tags.length} {tags.length === 1 ? "tag" : "tags"}
                    </Text>
                </View>

                {fetchError && (
                    <Text className="text-destructive text-sm mb-3">
                        {fetchError}
                    </Text>
                )}

                {loadingTags ? (
                    <Text className="text-muted-foreground text-lg">
                        Loading...
                    </Text>
                ) : (
                    <View className="flex-row flex-wrap gap-2.5">
                        {tags.map((tag) => (
                            <TagPill key={tag.id} tag={tag} height={20} />
                        ))}
                    </View>
                )}
            </ScrollView>

            <CreateTagDialog onTagCreated={handleTagCreated} />
        </View>
    );
}

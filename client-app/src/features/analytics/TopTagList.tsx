import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";

import { TagPill } from "@/components/custom/tag-pill";
import { Text } from "@/components/ui/text";
import type { TagPlayCount } from "@/lib/routes/analytics";

type Props = {
    tags: readonly TagPlayCount[];
    emptyLabel: string;
};

/**
 * The tags the user listens to, as pills with their play counts.
 *
 * The backend returns whole tags, so these are the same pills as everywhere
 * else rather than a stand-in built from a name and a color. Tapping one opens
 * its tag page.
 */
export function TopTagList({ tags, emptyLabel }: Props) {
    const router = useRouter();

    if (tags.length === 0) {
        return (
            <Text className="text-muted-foreground text-sm">{emptyLabel}</Text>
        );
    }

    return (
        <View className="flex-row flex-wrap gap-2">
            {tags.map((tag) => (
                <Pressable
                    key={tag.id}
                    onPress={() =>
                        router.push({
                            pathname: "/tag/[tagId]",
                            params: { tagId: tag.id },
                        })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${tag.name}, ${tag.plays} plays`}
                >
                    <TagPill tag={tag} height={14} count={tag.plays} />
                </Pressable>
            ))}
        </View>
    );
}

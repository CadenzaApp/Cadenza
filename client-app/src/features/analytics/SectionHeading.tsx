import { useRouter, type Href } from "expo-router";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";

type Props = {
    title: string;
    detail?: string;
    /** Adds a "See all" that opens it. */
    href?: Href;
};

/** A section's title, an optional line under it, and an optional "See all". */
export function SectionHeading({ title, detail, href }: Props) {
    const router = useRouter();
    return (
        <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1 gap-1">
                <Text role="heading" className="text-lg font-semibold">
                    {title}
                </Text>
                {detail ? (
                    <Text className="text-muted-foreground text-xs">
                        {detail}
                    </Text>
                ) : null}
            </View>
            {href ? (
                <Pressable
                    onPress={() => router.push(href)}
                    accessibilityRole="button"
                    accessibilityLabel={`See all ${title.toLowerCase()}`}
                    hitSlop={8}
                >
                    <Text className="text-muted-foreground text-sm">
                        See all
                    </Text>
                </Pressable>
            ) : null}
        </View>
    );
}

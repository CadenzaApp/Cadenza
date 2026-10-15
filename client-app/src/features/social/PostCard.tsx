import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { Pressable, StyleSheet, View } from "react-native";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

import { formatRelativeTime, initialsFromUsername } from "./format";
import type { SocialPost } from "./types";

type Props = {
    post: SocialPost;
    liked: boolean;
    onToggleLike: () => void;
};

/**
 * One feed row: author, body, and a local like control. No network calls yet;
 * likes only flip state on the screen that owns the feed.
 */
export function PostCard({ post, liked, onToggleLike }: Props) {
    const { colors } = useTheme();
    const likes = post.likes + (liked ? 1 : 0);

    return (
        <View className="gap-3 overflow-hidden rounded-3xl border border-border p-4">
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <GlassSurface
                    variant="regular"
                    style={StyleSheet.absoluteFill}
                />
            </View>

            <View className="flex-row items-center gap-3">
                <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
                    <Text className="text-sm font-semibold text-foreground">
                        {initialsFromUsername(post.author.username)}
                    </Text>
                </View>
                <View className="min-w-0 flex-1">
                    <Text
                        className="font-semibold text-foreground"
                        numberOfLines={1}
                    >
                        {post.author.username}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                        {formatRelativeTime(post.created_at)}
                    </Text>
                </View>
            </View>

            <Text className="text-base leading-6 text-foreground">
                {post.content}
            </Text>

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={liked ? "Unlike post" : "Like post"}
                accessibilityState={{ selected: liked }}
                onPress={onToggleLike}
                hitSlop={8}
                className="flex-row items-center gap-1.5 self-start active:opacity-60"
            >
                <Ionicons
                    name={liked ? "heart" : "heart-outline"}
                    size={18}
                    color={liked ? "#e11d48" : colors.text}
                />
                <Text
                    className={cn(
                        "text-sm",
                        liked ? "text-rose-600" : "text-muted-foreground",
                    )}
                >
                    {likes}
                </Text>
            </Pressable>
        </View>
    );
}

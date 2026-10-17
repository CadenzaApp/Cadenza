import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { useLikePost, useUnlikePost } from "@/lib/routes/social";
import { cn } from "@/lib/utils";

import { formatRelativeTime, initialsFromUsername } from "./format";
import { PostTopicCard } from "./PostTopicCard";
import { useResolvedTopic } from "./topic";
import type { PostTopic, SocialPost } from "./types";

type Props = {
    post: SocialPost;
    /** Full topic from compose, used until MusicKit hydrates the stored id. */
    topicHint?: PostTopic | null;
};

/** One feed row: author, attached topic, body, and the like control. */
export function PostCard({ post, topicHint }: Props) {
    const router = useRouter();
    const { likePost } = useLikePost();
    const { unlikePost } = useUnlikePost();
    const topic = useResolvedTopic(post.topic_mk_id, topicHint);
    const [liked, setLiked] = useState(post.liked);
    const likedRef = useRef(liked);
    useEffect(() => {
        likedRef.current = liked;
    }, [liked]);

    const likes = post.likes + (liked ? 1 : 0) - (post.liked ? 1 : 0);

    function toggleLike() {
        const nowLiked = !likedRef.current;
        likedRef.current = nowLiked;
        setLiked(nowLiked);
        if (post.post_id < 0) return;
        const request = nowLiked
            ? likePost(post.post_id)
            : unlikePost(post.post_id);
        void request.catch(() => {
            if (likedRef.current !== nowLiked) return;
            likedRef.current = !nowLiked;
            setLiked(!nowLiked);
        });
    }

    function openAuthor() {
        if (!post.author.user_id) return;
        router.push(`/social/user/${post.author.user_id}`);
    }

    const authorRow = (
        <>
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
        </>
    );

    return (
        <View className="gap-3 overflow-hidden rounded-3xl border border-border p-4">
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <GlassSurface
                    variant="regular"
                    style={StyleSheet.absoluteFill}
                />
            </View>

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View ${post.author.username}'s profile`}
                onPress={openAuthor}
                className="flex-row items-center gap-3 active:opacity-60"
            >
                {authorRow}
            </Pressable>

            {topic ? (
                <PostTopicCard topic={topic} cardId={String(post.post_id)} />
            ) : null}

            <Text className="text-base leading-6 text-foreground">
                {post.content}
            </Text>

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={liked ? "Unlike post" : "Like post"}
                accessibilityState={{ selected: liked }}
                onPress={toggleLike}
                hitSlop={8}
                className="flex-row items-center gap-1.5 self-start active:opacity-60"
            >
                <Ionicons
                    name={liked ? "heart" : "heart-outline"}
                    size={18}
                    color="#e11d48"
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

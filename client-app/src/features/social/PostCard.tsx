import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import {
    useLikePost,
    useUnlikePost,
    useUpdateCachedPostLike,
} from "@/lib/routes/social";
import { cn } from "@/lib/utils";

import { formatRelativeTime, initialsFromUsername } from "./format";
import { PostTopicCard } from "./PostTopicCard";
import { useResolvedTopic } from "./topic";
import type { PostTopic, SocialPost } from "./types";

type Props = {
    post: SocialPost;
    /** Full topic from compose, used until MusicKit hydrates the stored id. */
    topicHint?: PostTopic | null;
    /** Song or artist card under the author. Off on a page that is already that topic. */
    showTopic?: boolean;
    /**
     * When set, the like stays on this card. The caller writes the cached
     * lists later, after the screen that owns the card closes.
     */
    onLikedChange?: (postId: number, liked: boolean) => void;
    /**
     * Author tap. Defaults to pushing `/social/user/:userId` on the current
     * stack, which is what the feed wants. Discuss passes a handler that
     * closes itself first.
     */
    onAuthorPress?: (userId: string) => void;
};

/** One feed row: author, attached topic, body, and the like control. */
export function PostCard({
    post,
    topicHint,
    showTopic = true,
    onLikedChange,
    onAuthorPress,
}: Props) {
    const router = useRouter();
    const { likePost } = useLikePost();
    const { unlikePost } = useUnlikePost();
    const updateCachedPostLike = useUpdateCachedPostLike();
    const topic = useResolvedTopic(
        showTopic ? post.topic_mk_id : null,
        showTopic ? topicHint : null,
    );
    const [liked, setLiked] = useState(post.liked);
    const likedRef = useRef(liked);
    // The card remounts from the cached post after a navigation. Follow that
    // post, or an unlike that already saved still paints as liked.
    useEffect(() => {
        likedRef.current = post.liked;
        setLiked(post.liked);
    }, [post.liked, post.post_id]);

    const likes = post.likes + (liked ? 1 : 0) - (post.liked ? 1 : 0);

    function toggleLike() {
        const nowLiked = !likedRef.current;
        likedRef.current = nowLiked;
        setLiked(nowLiked);
        if (post.post_id < 0) return;
        if (onLikedChange) onLikedChange(post.post_id, nowLiked);
        else void updateCachedPostLike(post.post_id, nowLiked);
        const request = nowLiked
            ? likePost(post.post_id)
            : unlikePost(post.post_id);
        void request
            .then(() => {
                if (likedRef.current !== nowLiked || onLikedChange) return;
                return updateCachedPostLike(post.post_id, nowLiked);
            })
            .catch(() => {
                if (likedRef.current !== nowLiked) return;
                likedRef.current = !nowLiked;
                setLiked(!nowLiked);
                if (onLikedChange) onLikedChange(post.post_id, !nowLiked);
                else void updateCachedPostLike(post.post_id, !nowLiked);
            });
    }

    function openAuthor() {
        const userId = post.author.user_id;
        if (!userId) return;
        if (onAuthorPress) onAuthorPress(userId);
        else router.push(`/social/user/${userId}`);
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

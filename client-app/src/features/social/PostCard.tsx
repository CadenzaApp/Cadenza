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
import { PostCommentsDialog } from "./PostCommentsDialog";
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

/** One feed row: author, attached topic, body, likes, and comments. */
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
    const [commentsOpen, setCommentsOpen] = useState(false);
    // The card remounts from the cached post after a navigation. Follow that
    // post, or an unlike that already saved still paints as liked.
    useEffect(() => {
        likedRef.current = post.liked;
        setLiked(post.liked);
    }, [post.liked, post.post_id]);

    const propCommentCount = post.comment_count ?? 0;
    // Posts the user just created sit outside SWR, so the cache write never
    // reaches this card. Drop the extra once the prop count moves, or a later
    // cache update would add the same comment twice. A new post id starts over.
    const [commentBump, setCommentBump] = useState({
        postId: post.post_id,
        count: propCommentCount,
        extra: 0,
    });
    if (
        commentBump.postId !== post.post_id ||
        commentBump.count !== propCommentCount
    ) {
        setCommentBump({
            postId: post.post_id,
            count: propCommentCount,
            extra: 0,
        });
    }

    const likes = post.likes + (liked ? 1 : 0) - (post.liked ? 1 : 0);
    const commentCount =
        propCommentCount +
        (commentBump.postId === post.post_id &&
        commentBump.count === propCommentCount
            ? commentBump.extra
            : 0);

    function noteCommentCreated() {
        setCommentBump((current) => {
            const count = post.comment_count ?? 0;
            if (current.postId !== post.post_id || current.count !== count) {
                return { postId: post.post_id, count, extra: 1 };
            }
            return { ...current, extra: current.extra + 1 };
        });
    }

    function openComments() {
        if (post.post_id < 0) return;
        setCommentsOpen(true);
    }

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

    function openAuthor(userId?: string) {
        const id = userId || post.author.user_id;
        if (!id) return;
        if (onAuthorPress) onAuthorPress(id);
        else router.push(`/social/user/${id}`);
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
        <>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="View post comments"
                onPress={openComments}
                className="gap-3 overflow-hidden rounded-3xl border border-border p-4"
            >
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <GlassSurface
                        variant="regular"
                        style={StyleSheet.absoluteFill}
                    />
                </View>

                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View ${post.author.username}'s profile`}
                    onPress={(event) => {
                        event.stopPropagation();
                        openAuthor();
                    }}
                    className="flex-row items-center gap-3 active:opacity-60"
                >
                    {authorRow}
                </Pressable>

                {topic ? (
                    <PostTopicCard
                        topic={topic}
                        cardId={String(post.post_id)}
                    />
                ) : null}

                <Text className="text-base leading-6 text-foreground">
                    {post.content}
                </Text>

                <View className="flex-row items-center gap-4 self-start">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={liked ? "Unlike post" : "Like post"}
                        accessibilityState={{ selected: liked }}
                        onPress={(event) => {
                            event.stopPropagation();
                            toggleLike();
                        }}
                        hitSlop={8}
                        className="flex-row items-center gap-1.5 active:opacity-60"
                    >
                        <Ionicons
                            name={liked ? "heart" : "heart-outline"}
                            size={18}
                            color="#e11d48"
                        />
                        <Text
                            className={cn(
                                "text-sm",
                                liked
                                    ? "text-rose-600"
                                    : "text-muted-foreground",
                            )}
                        >
                            {likes}
                        </Text>
                    </Pressable>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="View comments"
                        onPress={(event) => {
                            event.stopPropagation();
                            openComments();
                        }}
                        hitSlop={8}
                        className="flex-row items-center gap-1.5 active:opacity-60"
                    >
                        <Ionicons
                            name="chatbubble-outline"
                            size={18}
                            color="#a1a1a1"
                        />
                        <Text className="text-sm text-muted-foreground">
                            {commentCount}
                        </Text>
                    </Pressable>
                </View>
            </Pressable>

            <PostCommentsDialog
                open={commentsOpen}
                onOpenChange={setCommentsOpen}
                post={post}
                topicHint={topicHint}
                showTopic={showTopic}
                onLikedChange={onLikedChange}
                onAuthorPress={openAuthor}
                onCommentCreated={noteCommentCreated}
            />
        </>
    );
}

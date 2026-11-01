import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/button";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import {
    useLikePost,
    useUnlikePost,
    useUpdateCachedPostContent,
    useUpdateCachedPostLike,
    useUpdatePost,
} from "@/lib/routes/social";
import { useAppTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

import { EditContentDialog } from "./EditContentDialog";
import { formatRelativeTime, initialsFromUsername } from "./format";
import { PostCommentsDialog } from "./PostCommentsDialog";
import { PostOptionsMenu } from "./PostOptionsMenu";
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
    /** The post left the screen. Fired before the delete request returns. */
    onDeleted?: (postId: number) => void;
    /** The delete request failed. The caller can show the post again. */
    onDeleteFailed?: (postId: number) => void;
    /**
     * The text changed on a copy the cache does not own, such as one just
     * written. `editedAt` is null when an edit is reverted.
     */
    onEdited?: (
        postId: number,
        content: string,
        editedAt: string | null,
    ) => void;
};

const MAX_POST_LENGTH = 500;

/** One feed row: author, attached topic, body, likes, and comments. */
export function PostCard({
    post,
    topicHint,
    showTopic = true,
    onLikedChange,
    onAuthorPress,
    onDeleted,
    onDeleteFailed,
    onEdited,
}: Props) {
    const { foreground, like, mutedForeground } = useAppTheme().colors;
    const { account } = useAccount();
    const router = useRouter();
    const { likePost } = useLikePost();
    const { unlikePost } = useUnlikePost();
    const updateCachedPostLike = useUpdateCachedPostLike();
    const { updatePost } = useUpdatePost();
    const updateCachedPostContent = useUpdateCachedPostContent();
    const isOwnPost = account?.id === post.author.user_id;
    const topic = useResolvedTopic(
        showTopic ? post.topic_mk_id : null,
        showTopic ? topicHint : null,
    );
    const [liked, setLiked] = useState(post.liked);
    const likedRef = useRef(liked);
    const [commentsOpen, setCommentsOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    // The card paints this as soon as Submit is pressed. The feed cache
    // follows, but the embed request is slow, so the prop can lag.
    const [savedEdit, setSavedEdit] = useState<{
        content: string;
        edited_at: string | null;
    } | null>(null);
    // The card remounts from the cached post after a navigation. Follow that
    // post, or an unlike that already saved still paints as liked.
    useEffect(() => {
        likedRef.current = post.liked;
        setLiked(post.liked);
    }, [post.liked, post.post_id]);

    useEffect(() => {
        if (!savedEdit) return;
        if (post.content === savedEdit.content) setSavedEdit(null);
    }, [post.content, savedEdit]);

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

    function noteCommentDeleted() {
        setCommentBump((current) => {
            const count = post.comment_count ?? 0;
            if (current.postId !== post.post_id || current.count !== count) {
                return { postId: post.post_id, count, extra: 0 };
            }
            return { ...current, extra: Math.max(0, current.extra - 1) };
        });
    }

    function openComments() {
        if (editing || post.post_id < 0) return;
        setCommentsOpen(true);
    }

    const displayPost: SocialPost = savedEdit
        ? {
              ...post,
              content: savedEdit.content,
              edited_at: savedEdit.edited_at,
          }
        : post;

    async function saveEdit(content: string) {
        const previous = {
            content: displayPost.content,
            edited_at: displayPost.edited_at ?? null,
        };
        const editedAt = new Date().toISOString();
        setSavedEdit({ content, edited_at: editedAt });
        setEditing(false);
        onEdited?.(post.post_id, content, editedAt);
        if (post.post_id <= 0) return;
        void updateCachedPostContent(post.post_id, content, editedAt);
        try {
            await updatePost(post.post_id, content);
        } catch (error) {
            console.error("Editing a post failed", error);
            setSavedEdit(previous);
            onEdited?.(post.post_id, previous.content, previous.edited_at);
            void updateCachedPostContent(
                post.post_id,
                previous.content,
                previous.edited_at,
            );
        }
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

                <View className="flex-row items-center">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`View ${post.author.username}'s profile`}
                        onPress={(event) => {
                            event.stopPropagation();
                            openAuthor();
                        }}
                        className="min-w-0 flex-1 flex-row items-center gap-3 active:opacity-60"
                    >
                        {authorRow}
                    </Pressable>
                    {isOwnPost ? (
                        <Button
                            size="icon"
                            variant="ghost"
                            className="-mr-2 h-10 w-10 shrink-0 rounded-full"
                            onPress={(event) => {
                                event.stopPropagation();
                                setMenuOpen(true);
                            }}
                            accessibilityLabel="Post options"
                        >
                            <Ionicons
                                name="ellipsis-horizontal"
                                size={24}
                                color={foreground}
                            />
                        </Button>
                    ) : null}
                </View>

                {topic ? (
                    <PostTopicCard
                        topic={topic}
                        cardId={String(post.post_id)}
                    />
                ) : null}

                <Text className="text-base leading-6 text-foreground">
                    {displayPost.content}
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
                            color={like}
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
                            color={mutedForeground}
                        />
                        <Text className="text-sm text-muted-foreground">
                            {commentCount}
                        </Text>
                    </Pressable>
                    {displayPost.edited_at ? (
                        <Text className="text-sm text-muted-foreground">
                            (edited)
                        </Text>
                    ) : null}
                </View>
            </Pressable>

            <PostOptionsMenu
                post={menuOpen ? displayPost : null}
                onClose={() => setMenuOpen(false)}
                onDeleted={onDeleted}
                onDeleteFailed={onDeleteFailed}
                onEdit={() => setEditing(true)}
            />

            <EditContentDialog
                open={editing}
                title="Edit Post"
                initial={displayPost.content}
                maxLength={MAX_POST_LENGTH}
                saving={false}
                onSubmit={(content) => void saveEdit(content)}
                onCancel={() => setEditing(false)}
            />

            <PostCommentsDialog
                open={commentsOpen}
                onOpenChange={setCommentsOpen}
                post={displayPost}
                topicHint={topicHint}
                showTopic={showTopic}
                onLikedChange={onLikedChange}
                onAuthorPress={openAuthor}
                onCommentCreated={noteCommentCreated}
                onCommentDeleted={noteCommentDeleted}
            />
        </>
    );
}

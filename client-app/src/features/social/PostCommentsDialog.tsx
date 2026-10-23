import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useColorScheme } from "nativewind";
import { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ModalPopup } from "@/components/custom/modal-popup";
import { Text } from "@/components/ui/text";
import { pinComments } from "@/lib/post-comment";
import { THEME } from "@/lib/theme";
import { useProfile } from "@/lib/routes/profile";
import {
    useCreateComment,
    useInsertCachedComment,
    useLikeComment,
    useLikePost,
    usePostComments,
    useUnlikeComment,
    useUnlikePost,
    useUpdateCachedCommentLike,
    useUpdateCachedPostCommentCount,
    useUpdateCachedPostLike,
} from "@/lib/routes/social";
import { cn } from "@/lib/utils";

import { formatRelativeTime, initialsFromUsername } from "./format";
import { PostTopicCard } from "./PostTopicCard";
import { useResolvedTopic } from "./topic";
import type { PostTopic, SocialComment, SocialPost } from "./types";

const MAX_DIALOG_WIDTH = 420;
const SCREEN_MARGIN = 20;
const DIALOG_PADDING = 20;
const MAX_COMMENT_LENGTH = 500;

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    post: SocialPost;
    topicHint?: PostTopic | null;
    showTopic?: boolean;
    onLikedChange?: (postId: number, liked: boolean) => void;
    onAuthorPress?: (userId: string) => void;
    /** A comment was stored. The card bumps its own count from this. */
    onCommentCreated?: () => void;
};

/** Post plus its comments, most liked first, with a composer. */
export function PostCommentsDialog({
    open,
    onOpenChange,
    post,
    topicHint,
    showTopic = true,
    onLikedChange,
    onAuthorPress,
    onCommentCreated,
}: Props) {
    const { colors } = useTheme();
    const { colorScheme = "light" } = useColorScheme();
    const sendColor =
        THEME[colorScheme === "dark" ? "dark" : "light"].primaryForeground;
    const insets = useSafeAreaInsets();
    const { width: screenWidth, height: screenHeight } = useWindowDimensions();
    const dialogWidth = Math.min(
        screenWidth - SCREEN_MARGIN * 2,
        MAX_DIALOG_WIDTH,
    );
    const { comments, postCommentsLoading, postCommentsErr } = usePostComments(
        post.post_id,
        open,
    );
    const { createComment } = useCreateComment();
    const insertCachedComment = useInsertCachedComment();
    const updateCommentCount = useUpdateCachedPostCommentCount();
    const { profile } = useProfile(open);
    const [draft, setDraft] = useState("");
    const [sending, setSending] = useState(false);
    // Newest first. Cleared only when this dialog unmounts.
    const [pinnedIds, setPinnedIds] = useState<number[]>([]);

    useEffect(() => {
        if (!open) setDraft("");
    }, [open]);

    function close() {
        onOpenChange(false);
    }

    function openAuthor(userId: string) {
        close();
        if (onAuthorPress) onAuthorPress(userId);
    }

    async function submit() {
        const content = draft.trim();
        if (!content || content.length > MAX_COMMENT_LENGTH) return;
        if (post.post_id < 0 || sending || postCommentsLoading) return;

        setSending(true);
        try {
            const commentId = await createComment({
                post_id: post.post_id,
                content,
            });
            if (commentId == null) return;
            const comment: SocialComment = {
                comment_id: commentId,
                post_id: post.post_id,
                content,
                likes: 0,
                liked: false,
                created_at: new Date().toISOString(),
                author: {
                    user_id: profile?.uid ?? "",
                    username: profile?.username ?? "unknown",
                },
            };
            setDraft("");
            setPinnedIds((ids) => [commentId, ...ids]);
            void insertCachedComment(comment);
            void updateCommentCount(post.post_id, 1);
            onCommentCreated?.();
        } finally {
            setSending(false);
        }
    }

    const trimmedLength = draft.trim().length;
    const canSend = trimmedLength > 0 && trimmedLength <= MAX_COMMENT_LENGTH;
    const orderedComments = pinComments(comments, pinnedIds);
    const maxDialogHeight = screenHeight - insets.top - insets.bottom - 24;
    const emptyLabel = postCommentsLoading
        ? "Loading comments..."
        : postCommentsErr
          ? "Couldn't load comments."
          : "No comments yet.";

    return (
        <ModalPopup
            visible={open}
            onClose={close}
            keyboardAware
            backdropClassName="justify-start py-0"
            contentStyle={{
                width: dialogWidth,
                maxWidth: dialogWidth,
                maxHeight: maxDialogHeight,
                padding: DIALOG_PADDING,
                marginTop: insets.top + 12,
            }}
        >
            <Pressable
                onPress={close}
                hitSlop={12}
                className="absolute right-4 top-4 z-10 rounded opacity-70 active:opacity-100"
                accessibilityRole="button"
                accessibilityLabel="Close comments"
            >
                <Ionicons name="close" size={18} color={colors.text} />
            </Pressable>

            <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                style={{ maxHeight: maxDialogHeight - DIALOG_PADDING * 2 }}
            >
                <View className="gap-3">
                    <PostSummary
                        post={post}
                        topicHint={topicHint}
                        showTopic={showTopic}
                        onLikedChange={onLikedChange}
                        onAuthorPress={openAuthor}
                    />

                    <Text className="pt-2 text-lg font-semibold leading-none">
                        Comments
                    </Text>

                    <View className="flex-row items-end gap-2">
                        <View className="min-h-[44px] flex-1 overflow-hidden rounded-2xl border border-border">
                            <TextInput
                                value={draft}
                                onChangeText={(text) =>
                                    setDraft(text.slice(0, MAX_COMMENT_LENGTH))
                                }
                                placeholder="Add a comment"
                                placeholderTextColor="#888888"
                                multiline
                                maxLength={MAX_COMMENT_LENGTH}
                                editable={
                                    post.post_id > 0 && !postCommentsLoading
                                }
                                textAlignVertical="top"
                                className="max-h-[96px] px-3 py-2.5 text-base text-foreground"
                            />
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Send comment"
                            disabled={
                                !canSend ||
                                sending ||
                                post.post_id < 0 ||
                                postCommentsLoading
                            }
                            onPress={() => void submit()}
                            className={cn(
                                "h-11 w-11 items-center justify-center rounded-full bg-primary shadow-sm shadow-black/5 active:bg-primary/90",
                                (!canSend ||
                                    sending ||
                                    post.post_id < 0 ||
                                    postCommentsLoading) &&
                                    "opacity-80",
                            )}
                        >
                            {sending ? (
                                <ActivityIndicator
                                    color={sendColor}
                                    size="small"
                                />
                            ) : (
                                <Ionicons
                                    name="send"
                                    size={16}
                                    color={sendColor}
                                />
                            )}
                        </Pressable>
                    </View>

                    {orderedComments.length === 0 ? (
                        <Text className="py-4 text-center text-sm text-muted-foreground">
                            {emptyLabel}
                        </Text>
                    ) : (
                        orderedComments.map((comment) => (
                            <CommentRow
                                key={comment.comment_id}
                                comment={comment}
                                onAuthorPress={openAuthor}
                            />
                        ))
                    )}
                </View>
            </ScrollView>
        </ModalPopup>
    );
}

function PostSummary({
    post,
    topicHint,
    showTopic,
    onLikedChange,
    onAuthorPress,
}: {
    post: SocialPost;
    topicHint?: PostTopic | null;
    showTopic: boolean;
    onLikedChange?: (postId: number, liked: boolean) => void;
    onAuthorPress?: (userId: string) => void;
}) {
    const { likePost } = useLikePost();
    const { unlikePost } = useUnlikePost();
    const updateCachedPostLike = useUpdateCachedPostLike();
    const topic = useResolvedTopic(
        showTopic ? post.topic_mk_id : null,
        showTopic ? topicHint : null,
    );
    const [liked, setLiked] = useState(post.liked);
    const likedRef = useRef(liked);

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

    return (
        <View className="gap-3 overflow-hidden rounded-3xl border border-border p-4">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View ${post.author.username}'s profile`}
                onPress={() => onAuthorPress?.(post.author.user_id)}
                disabled={!post.author.user_id}
                className="flex-row items-center gap-3 active:opacity-60"
            >
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
            </Pressable>

            {topic ? (
                <PostTopicCard
                    topic={topic}
                    cardId={`comments-${post.post_id}`}
                />
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

function CommentRow({
    comment,
    onAuthorPress,
}: {
    comment: SocialComment;
    onAuthorPress?: (userId: string) => void;
}) {
    const { likeComment } = useLikeComment();
    const { unlikeComment } = useUnlikeComment();
    const updateCachedCommentLike = useUpdateCachedCommentLike();
    const [liked, setLiked] = useState(comment.liked);
    const likedRef = useRef(liked);

    useEffect(() => {
        likedRef.current = comment.liked;
        setLiked(comment.liked);
    }, [comment.liked, comment.comment_id]);

    const likes = comment.likes + (liked ? 1 : 0) - (comment.liked ? 1 : 0);

    function toggleLike() {
        const nowLiked = !likedRef.current;
        likedRef.current = nowLiked;
        setLiked(nowLiked);
        if (comment.comment_id < 0) return;
        void updateCachedCommentLike(
            comment.post_id,
            comment.comment_id,
            nowLiked,
        );
        const request = nowLiked
            ? likeComment(comment.comment_id)
            : unlikeComment(comment.comment_id);
        void request.catch(() => {
            if (likedRef.current !== nowLiked) return;
            likedRef.current = !nowLiked;
            setLiked(!nowLiked);
            void updateCachedCommentLike(
                comment.post_id,
                comment.comment_id,
                !nowLiked,
            );
        });
    }

    return (
        <View className="gap-2 rounded-2xl px-3 py-3">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View ${comment.author.username}'s profile`}
                onPress={() => onAuthorPress?.(comment.author.user_id)}
                disabled={!comment.author.user_id}
                className="flex-row items-center gap-2.5 active:opacity-60"
            >
                <View className="h-8 w-8 items-center justify-center rounded-full bg-muted">
                    <Text className="text-xs font-semibold text-foreground">
                        {initialsFromUsername(comment.author.username)}
                    </Text>
                </View>
                <View className="min-w-0 flex-1">
                    <Text
                        className="text-sm font-semibold text-foreground"
                        numberOfLines={1}
                    >
                        {comment.author.username}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                        {formatRelativeTime(comment.created_at)}
                    </Text>
                </View>
            </Pressable>

            <Text className="text-sm leading-5 text-foreground">
                {comment.content}
            </Text>

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={liked ? "Unlike comment" : "Like comment"}
                accessibilityState={{ selected: liked }}
                onPress={toggleLike}
                hitSlop={8}
                className="flex-row items-center gap-1.5 self-start active:opacity-60"
            >
                <Ionicons
                    name={liked ? "heart" : "heart-outline"}
                    size={16}
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

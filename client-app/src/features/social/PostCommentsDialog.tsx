import Ionicons from "@expo/vector-icons/Ionicons";
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
import { Button } from "@/components/ui/button";
import { DialogCloseButton } from "@/components/ui/dialog-close-button";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useLoadMoreOnScroll } from "@/lib/load-more-on-scroll";
import {
    pinComments,
    sortCommentsByLikes,
    withPostedComments,
} from "@/lib/post-comment";
import { useProfile } from "@/lib/routes/profile";
import { useAppTheme } from "@/lib/theme";
import {
    useCreateComment,
    useLikeComment,
    useLikePost,
    usePostComments,
    useUnlikeComment,
    useUnlikePost,
    useUpdateCachedCommentContent,
    useUpdateCachedCommentLike,
    useUpdateCachedPostCommentCount,
    useUpdateCachedPostLike,
    useUpdateComment,
} from "@/lib/routes/social";
import { cn } from "@/lib/utils";

import { CommentOptionsMenu } from "./CommentOptionsMenu";
import { EditContentDialog } from "./EditContentDialog";
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
    /** A comment was deleted. The card drops its own count from this. */
    onCommentDeleted?: () => void;
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
    onCommentDeleted,
}: Props) {
    const { mutedForeground } = useAppTheme().colors;
    const sendColor = useAppTheme().colors.primaryForeground;
    const insets = useSafeAreaInsets();
    const { width: screenWidth, height: screenHeight } = useWindowDimensions();
    const dialogWidth = Math.min(
        screenWidth - SCREEN_MARGIN * 2,
        MAX_DIALOG_WIDTH,
    );
    const {
        comments,
        postCommentsLoading,
        postCommentsErr,
        isLoadingNextPage,
        loadNextPage,
        insertComment,
    } = usePostComments(post.post_id, open);
    const loadMoreScroll = useLoadMoreOnScroll(loadNextPage);
    const { createComment } = useCreateComment();
    const updateCommentCount = useUpdateCachedPostCommentCount();
    const { profile } = useProfile(open);
    const [draft, setDraft] = useState("");
    const [sending, setSending] = useState(false);
    // Newest first. Cleared only when this dialog unmounts.
    const [pinnedIds, setPinnedIds] = useState<number[]>([]);
    // Kept here so a comment shows before the paged cache includes it.
    const [posted, setPosted] = useState<SocialComment[]>([]);

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
        if (sending || postCommentsLoading) return;

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
                edited_at: null,
                author: {
                    user_id: profile?.uid ?? "",
                    username: profile?.username ?? "unknown",
                },
            };
            setDraft("");
            setPosted((rows) => [
                comment,
                ...rows.filter((row) => row.comment_id !== commentId),
            ]);
            setPinnedIds((ids) => [
                commentId,
                ...ids.filter((id) => id !== commentId),
            ]);
            void insertComment(comment);
            void updateCommentCount(post.post_id, 1);
            onCommentCreated?.();
        } finally {
            setSending(false);
        }
    }

    const trimmedLength = draft.trim().length;
    const canSend = trimmedLength > 0 && trimmedLength <= MAX_COMMENT_LENGTH;
    const orderedComments = pinComments(
        sortCommentsByLikes(withPostedComments(comments, posted, post.post_id)),
        pinnedIds,
    );
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
            <DialogCloseButton
                onPress={close}
                accessibilityLabel="Close comments"
            />

            <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                style={{ maxHeight: maxDialogHeight - DIALOG_PADDING * 2 }}
                scrollEventThrottle={16}
                onScroll={loadMoreScroll.onScroll}
                onLayout={loadMoreScroll.onLayout}
                onContentSizeChange={loadMoreScroll.onContentSizeChange}
                onMomentumScrollEnd={loadMoreScroll.onMomentumScrollEnd}
                onScrollEndDrag={loadMoreScroll.onScrollEndDrag}
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
                                placeholderTextColor={mutedForeground}
                                multiline
                                maxLength={MAX_COMMENT_LENGTH}
                                editable={!postCommentsLoading}
                                textAlignVertical="top"
                                className="max-h-[96px] px-3 py-2.5 text-base text-foreground"
                            />
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Send comment"
                            disabled={
                                !canSend || sending || postCommentsLoading
                            }
                            onPress={() => void submit()}
                            className={cn(
                                "h-11 w-11 items-center justify-center rounded-full bg-primary shadow-sm shadow-black/5 active:bg-primary/90",
                                (!canSend || sending || postCommentsLoading) &&
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
                                onDeleted={() => {
                                    setPosted((rows) =>
                                        rows.filter(
                                            (row) =>
                                                row.comment_id !==
                                                comment.comment_id,
                                        ),
                                    );
                                    setPinnedIds((ids) =>
                                        ids.filter(
                                            (id) => id !== comment.comment_id,
                                        ),
                                    );
                                    onCommentDeleted?.();
                                }}
                                onEdited={(content, editedAt) => {
                                    setPosted((rows) =>
                                        rows.map((row) =>
                                            row.comment_id ===
                                            comment.comment_id
                                                ? {
                                                      ...row,
                                                      content,
                                                      edited_at: editedAt,
                                                  }
                                                : row,
                                        ),
                                    );
                                }}
                            />
                        ))
                    )}
                    {isLoadingNextPage ? (
                        <View className="items-center py-3">
                            <ActivityIndicator color={mutedForeground} />
                        </View>
                    ) : null}
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
    const { like } = useAppTheme().colors;
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
        <View className="mt-8 gap-3 overflow-hidden rounded-3xl border border-border p-4">
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

            <View className="flex-row items-center gap-4 self-start">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={liked ? "Unlike post" : "Like post"}
                    accessibilityState={{ selected: liked }}
                    onPress={toggleLike}
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
                            liked ? "text-rose-600" : "text-muted-foreground",
                        )}
                    >
                        {likes}
                    </Text>
                </Pressable>
                {post.edited_at ? (
                    <Text className="text-sm text-muted-foreground">
                        (edited)
                    </Text>
                ) : null}
            </View>
        </View>
    );
}

function CommentRow({
    comment,
    onAuthorPress,
    onDeleted,
    onEdited,
}: {
    comment: SocialComment;
    onAuthorPress?: (userId: string) => void;
    onDeleted?: () => void;
    onEdited?: (content: string, editedAt: string) => void;
}) {
    const { account } = useAccount();
    const { foreground, like } = useAppTheme().colors;
    const isOwnComment = account?.id === comment.author.user_id;
    const [menuOpen, setMenuOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [savingEdit, setSavingEdit] = useState(false);
    const { updateComment } = useUpdateComment();
    const updateCachedCommentContent = useUpdateCachedCommentContent();
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

    async function saveEdit(content: string) {
        const editedAtMs = Date.now();
        const editedAt = new Date(editedAtMs).toISOString();
        setSavingEdit(true);
        try {
            await updateComment(comment.comment_id, content, editedAtMs);
            await updateCachedCommentContent(
                comment.post_id,
                comment.comment_id,
                content,
                editedAt,
            );
            onEdited?.(content, editedAt);
            setEditing(false);
        } catch (error) {
            console.error("Editing a comment failed", error);
        } finally {
            setSavingEdit(false);
        }
    }

    function toggleLike() {
        const nowLiked = !likedRef.current;
        likedRef.current = nowLiked;
        setLiked(nowLiked);
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
            <View className="flex-row items-center">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View ${comment.author.username}'s profile`}
                    onPress={() => onAuthorPress?.(comment.author.user_id)}
                    disabled={!comment.author.user_id}
                    className="min-w-0 flex-1 flex-row items-center gap-2.5 active:opacity-60"
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
                {isOwnComment ? (
                    <Button
                        size="icon"
                        variant="ghost"
                        className="-mr-2 h-8 w-8 shrink-0 rounded-full"
                        onPress={() => setMenuOpen(true)}
                        accessibilityLabel="Comment options"
                    >
                        <Ionicons
                            name="ellipsis-horizontal"
                            size={20}
                            color={foreground}
                        />
                    </Button>
                ) : null}
            </View>

            <Text className="text-sm leading-5 text-foreground">
                {comment.content}
            </Text>

            <View className="flex-row items-center gap-4 self-start">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                        liked ? "Unlike comment" : "Like comment"
                    }
                    accessibilityState={{ selected: liked }}
                    onPress={toggleLike}
                    hitSlop={8}
                    className="flex-row items-center gap-1.5 active:opacity-60"
                >
                    <Ionicons
                        name={liked ? "heart" : "heart-outline"}
                        size={16}
                        color={like}
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
                {comment.edited_at ? (
                    <Text className="text-sm text-muted-foreground">
                        (edited)
                    </Text>
                ) : null}
            </View>

            <CommentOptionsMenu
                comment={menuOpen ? comment : null}
                onClose={() => setMenuOpen(false)}
                onDeleted={() => onDeleted?.()}
                onEdit={() => setEditing(true)}
            />

            <EditContentDialog
                open={editing}
                title="Edit Comment"
                initial={comment.content}
                maxLength={MAX_COMMENT_LENGTH}
                saving={savingEdit}
                onSubmit={(content) => void saveEdit(content)}
                onCancel={() => setEditing(false)}
            />
        </View>
    );
}

import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    TextInput,
    View,
} from "react-native";
import Animated, {
    useAnimatedKeyboard,
    useAnimatedStyle,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { TintBackdrop } from "@/components/ui/tint-backdrop";
import { useAccount } from "@/lib/account";
import { useArtworkTint } from "@/lib/artwork-color";
import { orderThreadsLike, sortThreadsByVotes } from "@/lib/comment-votes";
import {
    useCreateComment,
    useDeleteComment,
    useSongComments,
    useVoteOnComment,
} from "@/lib/routes/comments";
import type { Comment, CommentThread, CommentVote } from "@/lib/types";

import type { FocusedSong } from "./player-pager";

/** What other users' comments are signed with, until users have names. */
const PLACEHOLDER_AUTHOR = "Anonymous";

/** The thread ids in the order the page is holding them, and their song. */
type HeldOrder = { songId: string; ids: number[] };

/**
 * The now-playing sheet's Comments page: every user's comments on the focused
 * song, highest score first. The user can post a comment, reply to a top level
 * comment, vote on top level comments, and delete their own comments and
 * replies.
 *
 * The backend has no names for users yet, so the user's own comments are signed
 * with their email and everyone else's with a placeholder.
 *
 * Same rule as Tags: no artwork, no playback controls, only the gradient.
 */
export function CommentsPage({
    focusedSong,
    active,
}: {
    focusedSong: FocusedSong;
    /** whether the pager is on this page */
    active: boolean;
}) {
    const insets = useSafeAreaInsets();
    const { tint } = useArtworkTint(focusedSong);
    const { account } = useAccount();
    const { songComments, songCommentsErr } = useSongComments(focusedSong.id);
    const { createComment, createCommentLoading } = useCreateComment();
    const { deleteComment } = useDeleteComment();
    const { voteOnComment } = useVoteOnComment(focusedSong.id);
    // The order the threads were sorted in when the page came into view, held
    // so a vote does not move a comment out from under the user. Sorted again
    // when the page comes back into view or the song changes. Out of view the
    // threads sort live, so a changed order settles as the page slides away.
    const [heldOrder, setHeldOrder] = useState<HeldOrder | null>(null);
    if (!active || !songComments) {
        if (heldOrder) setHeldOrder(null);
    } else if (heldOrder?.songId !== focusedSong.id) {
        setHeldOrder({
            songId: focusedSong.id,
            ids: sortThreadsByVotes(songComments).map(({ id }) => id),
        });
    }
    const threads =
        songComments &&
        (heldOrder
            ? orderThreadsLike(songComments, heldOrder.ids)
            : sortThreadsByVotes(songComments));
    const [draft, setDraft] = useState("");
    const [replyTarget, setReplyTarget] = useState<number | null>(null);
    const [replyDraft, setReplyDraft] = useState("");
    // the last write that failed, shown over the composer until the next write
    const [writeErr, setWriteErr] = useState<string | null>(null);
    // Drives the composer above the keyboard directly off its native frame,
    // rather than through `KeyboardAvoidingView`: this page sits inside a
    // native form sheet (`DetailScreen` / `player.tsx`), and the sheet's own
    // offset from the screen top throws off `KeyboardAvoidingView`'s padding
    // math, leaving the composer under the keyboard.
    const keyboard = useAnimatedKeyboard();
    const composerStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: -keyboard.height.value }],
    }));

    function authorOf(comment: Comment) {
        return comment.mine && account ? account.email : PLACEHOLDER_AUTHOR;
    }

    async function postComment() {
        const content = draft.trim();
        if (!content || createCommentLoading) return;
        setWriteErr(null);
        try {
            await createComment({ song_id: focusedSong.id, content });
            setDraft("");
        } catch (error) {
            setWriteErr(failureText("Couldn't post your comment.", error));
        }
    }

    async function postReply(parentId: number) {
        const content = replyDraft.trim();
        if (!content || createCommentLoading) return;
        setWriteErr(null);
        try {
            await createComment({
                song_id: focusedSong.id,
                content,
                parent_id: parentId,
            });
            setReplyDraft("");
            setReplyTarget(null);
        } catch (error) {
            setWriteErr(failureText("Couldn't post your reply.", error));
        }
    }

    async function vote(comment: Comment, direction: CommentVote) {
        setWriteErr(null);
        // pressing the vote the user already cast takes it back
        const next = comment.my_vote === direction ? null : direction;
        try {
            await voteOnComment(comment.id, next);
        } catch (error) {
            setWriteErr(failureText("Couldn't save your vote.", error));
        }
    }

    function confirmDelete(comment: Comment, hasReplies: boolean) {
        Alert.alert(
            "Delete comment?",
            hasReplies ? "Every reply to it is deleted too." : undefined,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                        setWriteErr(null);
                        try {
                            await deleteComment({ comment_id: comment.id });
                        } catch (error) {
                            setWriteErr(
                                failureText("Couldn't delete your comment.", error),
                            );
                        }
                    },
                },
            ],
        );
    }

    return (
        <View className="flex-1">
            <TintBackdrop tint={tint} />
            <ScrollView
                contentContainerClassName="gap-4 px-6 pt-4"
                contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
                showsVerticalScrollIndicator={false}
            >
                <View>
                    <Text className="text-2xl font-bold text-foreground">
                        Comments
                    </Text>
                    <Text
                        className="mt-0.5 text-base text-muted-foreground"
                        numberOfLines={1}
                    >
                        {focusedSong.title}
                    </Text>
                </View>

                {threads ? (
                    threads.length === 0 ? (
                        <Text className="py-8 text-center text-muted-foreground">
                            No comments yet. Be the first to say something.
                        </Text>
                    ) : (
                        threads.map((thread) => (
                            <CommentRow
                                key={thread.id}
                                thread={thread}
                                authorOf={authorOf}
                                replyOpen={replyTarget === thread.id}
                                replyDraft={replyDraft}
                                posting={createCommentLoading}
                                onReplyDraftChange={setReplyDraft}
                                onToggleReply={() =>
                                    setReplyTarget((current) =>
                                        current === thread.id ? null : thread.id,
                                    )
                                }
                                onSubmitReply={() => postReply(thread.id)}
                                onVote={(direction) => vote(thread, direction)}
                                onDelete={confirmDelete}
                            />
                        ))
                    )
                ) : songCommentsErr ? (
                    <Text className="py-8 text-center text-muted-foreground">
                        Couldn&apos;t load comments.
                    </Text>
                ) : (
                    <View className="py-8">
                        <ActivityIndicator color="#888888" />
                    </View>
                )}
            </ScrollView>

            <Animated.View
                className="gap-2 px-4 pt-3"
                style={[composerStyle, { paddingBottom: insets.bottom + 12 }]}
            >
                {writeErr ? (
                    <Text className="text-sm text-destructive">{writeErr}</Text>
                ) : null}
                <View className="flex-row items-end gap-2">
                    <View className="flex-1 overflow-hidden rounded-3xl border border-border">
                        <GlassSurface style={StyleSheet.absoluteFill} />
                        <TextInput
                            value={draft}
                            onChangeText={setDraft}
                            placeholder="Add a comment"
                            placeholderTextColor="#888888"
                            className="px-4 py-2 text-foreground"
                            multiline
                        />
                    </View>
                    <GlassIconButton
                        accessibilityLabel="Post comment"
                        disabled={!draft.trim() || createCommentLoading}
                        onPress={postComment}
                        className={
                            !draft.trim() || createCommentLoading
                                ? "opacity-40"
                                : undefined
                        }
                    >
                        <Ionicons name="arrow-up" size={20} color="#888888" />
                    </GlassIconButton>
                </View>
            </Animated.View>
        </View>
    );
}

/**
 * The line shown for a failed write: `prefix`, then the error's own message
 * when it has one. Backend errors arrive as the parsed `{ error_type, message }`
 * body rather than an `Error`, and some of them have no message.
 */
function failureText(prefix: string, error: unknown) {
    const message =
        typeof error === "object" && error !== null && "message" in error
            ? String(error.message)
            : "";
    return message ? `${prefix} ${message}` : prefix;
}

function CommentRow({
    thread,
    authorOf,
    replyOpen,
    replyDraft,
    posting,
    onReplyDraftChange,
    onToggleReply,
    onSubmitReply,
    onVote,
    onDelete,
}: {
    thread: CommentThread;
    authorOf: (comment: Comment) => string;
    replyOpen: boolean;
    replyDraft: string;
    /** whether a comment or reply is being posted, which holds off another */
    posting: boolean;
    onReplyDraftChange: (value: string) => void;
    onToggleReply: () => void;
    onSubmitReply: () => void;
    onVote: (direction: CommentVote) => void;
    onDelete: (comment: Comment, hasReplies: boolean) => void;
}) {
    const replyDisabled = !replyDraft.trim() || posting;

    return (
        <View className="gap-2 rounded-xl border border-border bg-card/60 p-3">
            <Text className="font-semibold text-foreground" numberOfLines={1}>
                {authorOf(thread)}
            </Text>
            <Text className="text-foreground">{thread.content}</Text>

            <View className="flex-row items-center gap-4">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Upvote"
                    accessibilityState={{ selected: thread.my_vote === "up" }}
                    onPress={() => onVote("up")}
                    className="flex-row items-center gap-1 active:opacity-60"
                >
                    <Ionicons
                        name="arrow-up"
                        size={16}
                        color={thread.my_vote === "up" ? "#22c55e" : "#888888"}
                    />
                </Pressable>
                <Text className="text-sm text-muted-foreground">
                    {thread.votes}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Downvote"
                    accessibilityState={{ selected: thread.my_vote === "down" }}
                    onPress={() => onVote("down")}
                    className="flex-row items-center gap-1 active:opacity-60"
                >
                    <Ionicons
                        name="arrow-down"
                        size={16}
                        color={thread.my_vote === "down" ? "#ef4444" : "#888888"}
                    />
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Reply"
                    onPress={onToggleReply}
                    className="active:opacity-60"
                >
                    <Text className="text-sm font-medium text-muted-foreground">
                        Reply
                    </Text>
                </Pressable>
                {thread.mine ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Delete comment"
                        onPress={() => onDelete(thread, thread.replies.length > 0)}
                        className="active:opacity-60"
                    >
                        <Text className="text-sm font-medium text-muted-foreground">
                            Delete
                        </Text>
                    </Pressable>
                ) : null}
            </View>

            {replyOpen ? (
                <View className="flex-row items-center gap-2 pt-1">
                    <View className="flex-1 overflow-hidden rounded-full border border-border">
                        <GlassSurface style={StyleSheet.absoluteFill} />
                        <TextInput
                            value={replyDraft}
                            onChangeText={onReplyDraftChange}
                            placeholder="Write a reply"
                            placeholderTextColor="#888888"
                            className="px-3 py-1.5 text-foreground"
                        />
                    </View>
                    <GlassIconButton
                        size={32}
                        accessibilityLabel="Post reply"
                        disabled={replyDisabled}
                        onPress={onSubmitReply}
                        className={replyDisabled ? "opacity-40" : undefined}
                    >
                        <Ionicons name="arrow-up" size={16} color="#888888" />
                    </GlassIconButton>
                </View>
            ) : null}

            {thread.replies.length > 0 ? (
                <View className="mt-1 gap-2 border-l border-border pl-3">
                    {thread.replies.map((reply) => (
                        <View key={reply.id}>
                            <Text
                                className="font-semibold text-foreground"
                                numberOfLines={1}
                            >
                                {authorOf(reply)}
                            </Text>
                            <Text className="text-foreground">{reply.content}</Text>
                            {reply.mine ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Delete reply"
                                    onPress={() => onDelete(reply, false)}
                                    className="mt-1 self-start active:opacity-60"
                                >
                                    <Text className="text-sm font-medium text-muted-foreground">
                                        Delete
                                    </Text>
                                </Pressable>
                            ) : null}
                        </View>
                    ))}
                </View>
            ) : null}
        </View>
    );
}

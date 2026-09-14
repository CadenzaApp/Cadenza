import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated, {
    useAnimatedKeyboard,
    useAnimatedStyle,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { TintBackdrop } from "@/components/ui/tint-backdrop";
import { useArtworkTint } from "@/lib/artwork-color";

import type { FocusedSong } from "./player-pager";

type Vote = "up" | "down" | null;

type Comment = {
    id: string;
    author: string;
    body: string;
    votes: number;
    myVote: Vote;
    replies: Comment[];
};

let nextCommentId = 0;
function makeComment(author: string, body: string): Comment {
    nextCommentId += 1;
    return {
        id: `local-${nextCommentId}`,
        author,
        body,
        votes: 0,
        myVote: null,
        replies: [],
    };
}

/**
 * The now-playing sheet's Comments page: a stub of a social feed for the
 * focused song. No backend and no seed data - comments live only in local
 * state for as long as the sheet does, so reading, replying, writing, and
 * voting all have somewhere real to act on even though nothing persists yet.
 *
 * Same rule as Tags: no artwork, no playback controls, only the gradient.
 */
export function CommentsPage({ focusedSong }: { focusedSong: FocusedSong }) {
    const insets = useSafeAreaInsets();
    const { tint } = useArtworkTint(focusedSong);
    const [comments, setComments] = useState<Comment[]>([]);
    const [draft, setDraft] = useState("");
    const [replyTarget, setReplyTarget] = useState<string | null>(null);
    const [replyDraft, setReplyDraft] = useState("");
    // Drives the composer above the keyboard directly off its native frame,
    // rather than through `KeyboardAvoidingView`: this page sits inside a
    // native form sheet (`DetailScreen` / `player.tsx`), and the sheet's own
    // offset from the screen top throws off `KeyboardAvoidingView`'s padding
    // math, leaving the composer under the keyboard.
    const keyboard = useAnimatedKeyboard();
    const composerStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: -keyboard.height.value }],
    }));

    function postComment() {
        const body = draft.trim();
        if (!body) return;
        setComments((current) => [makeComment("You", body), ...current]);
        setDraft("");
    }

    function postReply(parentId: string) {
        const body = replyDraft.trim();
        if (!body) return;
        setComments((current) =>
            current.map((comment) =>
                comment.id === parentId
                    ? {
                          ...comment,
                          replies: [...comment.replies, makeComment("You", body)],
                      }
                    : comment,
            ),
        );
        setReplyDraft("");
        setReplyTarget(null);
    }

    function vote(commentId: string, direction: "up" | "down") {
        setComments((current) =>
            current.map((comment) => {
                if (comment.id !== commentId) return comment;
                const next = comment.myVote === direction ? null : direction;
                const delta =
                    (next === "up" ? 1 : next === "down" ? -1 : 0) -
                    (comment.myVote === "up"
                        ? 1
                        : comment.myVote === "down"
                          ? -1
                          : 0);
                return { ...comment, myVote: next, votes: comment.votes + delta };
            }),
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

                {comments.length === 0 ? (
                    <Text className="py-8 text-center text-muted-foreground">
                        No comments yet. Be the first to say something.
                    </Text>
                ) : (
                    comments.map((comment) => (
                        <CommentRow
                            key={comment.id}
                            comment={comment}
                            replyOpen={replyTarget === comment.id}
                            replyDraft={replyDraft}
                            onReplyDraftChange={setReplyDraft}
                            onToggleReply={() =>
                                setReplyTarget((current) =>
                                    current === comment.id ? null : comment.id,
                                )
                            }
                            onSubmitReply={() => postReply(comment.id)}
                            onVote={(direction) => vote(comment.id, direction)}
                        />
                    ))
                )}
            </ScrollView>

            <Animated.View
                className="flex-row items-end gap-2 px-4 pt-3"
                style={[composerStyle, { paddingBottom: insets.bottom + 12 }]}
            >
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
                    disabled={!draft.trim()}
                    onPress={postComment}
                    className={!draft.trim() ? "opacity-40" : undefined}
                >
                    <Ionicons name="arrow-up" size={20} color="#888888" />
                </GlassIconButton>
            </Animated.View>
        </View>
    );
}

function CommentRow({
    comment,
    replyOpen,
    replyDraft,
    onReplyDraftChange,
    onToggleReply,
    onSubmitReply,
    onVote,
}: {
    comment: Comment;
    replyOpen: boolean;
    replyDraft: string;
    onReplyDraftChange: (value: string) => void;
    onToggleReply: () => void;
    onSubmitReply: () => void;
    onVote: (direction: "up" | "down") => void;
}) {
    return (
        <View className="gap-2 rounded-xl border border-border bg-card/60 p-3">
            <Text className="font-semibold text-foreground">
                {comment.author}
            </Text>
            <Text className="text-foreground">{comment.body}</Text>

            <View className="flex-row items-center gap-4">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Upvote"
                    accessibilityState={{ selected: comment.myVote === "up" }}
                    onPress={() => onVote("up")}
                    className="flex-row items-center gap-1 active:opacity-60"
                >
                    <Ionicons
                        name="arrow-up"
                        size={16}
                        color={comment.myVote === "up" ? "#22c55e" : "#888888"}
                    />
                </Pressable>
                <Text className="text-sm text-muted-foreground">
                    {comment.votes}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Downvote"
                    accessibilityState={{ selected: comment.myVote === "down" }}
                    onPress={() => onVote("down")}
                    className="flex-row items-center gap-1 active:opacity-60"
                >
                    <Ionicons
                        name="arrow-down"
                        size={16}
                        color={comment.myVote === "down" ? "#ef4444" : "#888888"}
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
                        disabled={!replyDraft.trim()}
                        onPress={onSubmitReply}
                        className={!replyDraft.trim() ? "opacity-40" : undefined}
                    >
                        <Ionicons name="arrow-up" size={16} color="#888888" />
                    </GlassIconButton>
                </View>
            ) : null}

            {comment.replies.length > 0 ? (
                <View className="mt-1 gap-2 border-l border-border pl-3">
                    {comment.replies.map((reply) => (
                        <View key={reply.id}>
                            <Text className="font-semibold text-foreground">
                                {reply.author}
                            </Text>
                            <Text className="text-foreground">{reply.body}</Text>
                        </View>
                    ))}
                </View>
            ) : null}
        </View>
    );
}

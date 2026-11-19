import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { memo, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { Button } from "@/components/ui/button";
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
import { withAlpha } from "@/lib/artwork-color";
import { cn } from "@/lib/utils";
import type { FriendListening } from "@/lib/routes/listening";
import { RemoteArtwork } from "@/components/ui/remote-artwork";

import { EditContentDialog } from "./EditContentDialog";
import { formatRelativeTime, initialsFromUsername } from "./format";
import { ListeningStoryDialog } from "./ListeningNow";
import { PostCommentsDialog } from "./PostCommentsDialog";
import { PostOptionsMenu } from "./PostOptionsMenu";
import { PostTopicCard } from "./PostTopicCard";
import { SharedPlaylistPostCard } from "./SharedPlaylistPostCard";
import { activityLabel, topicCreateFields, useResolvedTopic } from "./topic";
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
    /** The author's visible now-playing state, for the story-style avatar. */
    authorListening?: FriendListening;
    /** Shows a small unread indicator on feed items the caller has not seen. */
    unseen?: boolean;
};

const MAX_POST_LENGTH = 500;

/**
 * One feed row: author, attached topic, body, likes, and comments. Memoized,
 * so a feed re-render only redraws the posts whose props changed.
 */
export const PostCard = memo(PostCardBase);

function PostCardBase({
    post,
    topicHint,
    showTopic = true,
    onLikedChange,
    onAuthorPress,
    onDeleted,
    onDeleteFailed,
    onEdited,
    authorListening,
    unseen = false,
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
    // Resolved even when the card hides the topic, so an edit can send the
    // same title and artist the create request uses for the embedding.
    const topic = useResolvedTopic(post.topic_mk_id, topicHint);
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
        if (editing) return;
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
        const editedAtMs = Date.now();
        const editedAt = new Date(editedAtMs).toISOString();
        setSavedEdit({ content, edited_at: editedAt });
        setEditing(false);
        onEdited?.(post.post_id, content, editedAt);
        void updateCachedPostContent(post.post_id, content, editedAt);
        try {
            const names =
                post.topic_mk_id && topic ? topicCreateFields(topic) : null;
            await updatePost(
                post.post_id,
                content,
                editedAtMs,
                names
                    ? {
                          topic_song_title: names.topic_song_title,
                          topic_artist_name: names.topic_artist_name,
                      }
                    : undefined,
            );
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
        <View className="min-w-0 flex-1 flex-row items-center gap-3">
            <PostAuthorAvatar
                username={post.author.username}
                listening={authorListening}
                unseen={unseen}
                onProfilePress={() => openAuthor()}
            />
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View ${post.author.username}'s profile`}
                onPress={(event) => {
                    event.stopPropagation();
                    openAuthor();
                }}
                className="min-w-0 flex-1 active:opacity-60"
            >
                <Text
                    className="font-semibold text-foreground"
                    numberOfLines={1}
                >
                    {post.author.username}
                </Text>
                <Text className="text-xs text-muted-foreground">
                    {formatRelativeTime(post.created_at)}
                    {topic
                        ? ` · ${activityLabel(topic)}`
                        : post.shared_playlist
                          ? " · Shared a playlist"
                          : ""}
                </Text>
            </Pressable>
        </View>
    );

    return (
        <>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="View post comments"
                onPress={openComments}
                className="gap-3 border-b px-1 py-5"
                style={{ borderBottomColor: withAlpha(mutedForeground, 0.55) }}
            >
                <View className="flex-row items-center">
                    {authorRow}
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

                {showTopic && topic ? (
                    <PostTopicCard
                        topic={topic}
                        cardId={String(post.post_id)}
                    />
                ) : null}
                {post.shared_playlist ? (
                    <SharedPlaylistPostCard playlist={post.shared_playlist} />
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

function PostAuthorAvatar({
    username,
    listening,
    unseen,
    onProfilePress,
}: {
    username: string;
    listening?: FriendListening;
    unseen: boolean;
    onProfilePress: () => void;
}) {
    const [open, setOpen] = useState(false);
    const { brand, mutedForeground } = useAppTheme().colors;
    const live = Boolean(
        listening?.can_join && listening.now_playing.live_session_id,
    );
    const ring = live ? brand : withAlpha(mutedForeground, 0.55);
    return (
        <>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                    listening
                        ? `${username} is listening to ${listening.now_playing.title}`
                        : `View ${username}'s profile`
                }
                onPress={(event) => {
                    event.stopPropagation();
                    if (listening) setOpen(true);
                    else onProfilePress();
                }}
                className="h-10 w-10 overflow-visible rounded-full"
                style={{
                    shadowColor: "#000",
                    shadowOpacity: 0.22,
                    shadowRadius: 4,
                    shadowOffset: { width: 0, height: 2 },
                    elevation: 3,
                }}
            >
                <View
                    className="h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 bg-muted p-0.5"
                    style={{ borderColor: listening ? ring : "transparent" }}
                >
                    {listening ? (
                        <RemoteArtwork
                            url={listening.now_playing.artwork_url}
                            className="h-full w-full rounded-full"
                            fallback={
                                <Text className="text-sm font-semibold text-foreground">
                                    {initialsFromUsername(username)}
                                </Text>
                            }
                        />
                    ) : (
                        <Text className="text-sm font-semibold text-foreground">
                            {initialsFromUsername(username)}
                        </Text>
                    )}
                </View>
                {unseen ? (
                    <View className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-background bg-destructive" />
                ) : null}
            </Pressable>
            {listening ? (
                <ListeningStoryDialog
                    friend={listening}
                    open={open}
                    onClose={() => setOpen(false)}
                />
            ) : null}
        </>
    );
}

import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
import { CreatePostDialog } from "@/features/social/CreatePostDialog";
import { PostCard } from "@/features/social/PostCard";
import { topicCreateFields, topicMkId } from "@/features/social/topic";
import type { PostTopic, SocialPost } from "@/features/social/types";
import { useSongInfo } from "@/lib/musickit-hooks";
import { useProfile } from "@/lib/routes/profile";
import {
    useCreatePost,
    useTopicPosts,
    useUpdateCachedPostLike,
} from "@/lib/routes/social";

import type { FocusedSong } from "./player-scope";

/** The now-playing sheet's Discuss page: posts about the focused song. */
export function DiscussPage({
    focusedSong,
    enabled = true,
    active = true,
}: {
    focusedSong: FocusedSong;
    /** Becomes true after this pager page is first visited. */
    enabled?: boolean;
    /** False once the user leaves this page. Likes flush to the cache then. */
    active?: boolean;
}) {
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();
    const { profile } = useProfile(enabled);
    const { createPost } = useCreatePost();
    const updateCachedPostLike = useUpdateCachedPostLike();
    const pendingLikes = useRef(new Map<number, boolean>());
    const activeRef = useRef(active);
    const flushPendingLikes = useCallback(() => {
        if (pendingLikes.current.size === 0) return;
        const pending = pendingLikes.current;
        pendingLikes.current = new Map();
        for (const [postId, liked] of pending) {
            void updateCachedPostLike(postId, liked);
        }
    }, [updateCachedPostLike]);
    const flushPendingLikesRef = useRef(flushPendingLikes);
    flushPendingLikesRef.current = flushPendingLikes;

    const rememberLike = useCallback((postId: number, liked: boolean) => {
        pendingLikes.current.set(postId, liked);
        if (!activeRef.current) flushPendingLikesRef.current();
    }, []);

    useEffect(() => {
        const wasActive = activeRef.current;
        activeRef.current = active;
        if (wasActive && !active) flushPendingLikesRef.current();
    }, [active]);

    useEffect(() => () => flushPendingLikesRef.current(), []);
    const { posts, topicPostsLoading, topicPostsErr, refreshTopicPosts } =
        useTopicPosts(focusedSong.id, enabled);
    const songIds = useMemo(
        () => (enabled ? [focusedSong.id] : null),
        [enabled, focusedSong.id],
    );
    const { songInfo } = useSongInfo(songIds);
    const song = useMemo(
        () =>
            songInfo.find(
                (item) =>
                    item.id === focusedSong.id ||
                    item.catalogId === focusedSong.id,
            ),
        [songInfo, focusedSong.id],
    );
    const topic = useMemo<Extract<PostTopic, { kind: "song" }>>(
        () => ({
            kind: "song",
            id: focusedSong.id,
            // The list filters on this id, so the stored topic must match it
            // even when Apple Music reports a different catalog id.
            catalogId: focusedSong.id,
            title: song?.title || focusedSong.title,
            artistName: song?.artistName,
            artworkUrl: song?.artworkUrl ?? focusedSong.artworkUrl,
            artworkColor: song?.artworkColor ?? focusedSong.artworkColor,
            playbackId: song?.playbackId,
            songDuration: song?.songDuration,
            previewUrl: song?.previewUrl,
        }),
        [
            focusedSong.artworkColor,
            focusedSong.artworkUrl,
            focusedSong.id,
            focusedSong.title,
            song,
        ],
    );

    const [createdFor, setCreatedFor] = useState(focusedSong.id);
    const [created, setCreated] = useState<SocialPost[]>([]);
    if (createdFor !== focusedSong.id) {
        setCreatedFor(focusedSong.id);
        setCreated([]);
    }
    const [refreshing, setRefreshing] = useState(false);
    const [composeOpen, setComposeOpen] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const nextTempId = useRef(0);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = useCallback((message: string) => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast(message);
        toastTimer.current = setTimeout(() => setToast(null), 3000);
    }, []);

    useEffect(
        () => () => {
            if (toastTimer.current) clearTimeout(toastTimer.current);
        },
        [],
    );

    const rankedPosts = useMemo(() => {
        const loaded = new Set(posts.map((post) => post.post_id));
        const pending = created.filter((post) => !loaded.has(post.post_id));
        return [...posts, ...pending].sort(byLikesThenNewest);
    }, [created, posts]);

    const handleCreate = useCallback(
        (content: string, attached?: PostTopic | null) => {
            const postedTopic = attached ?? topic;
            nextTempId.current -= 1;
            const tempId = nextTempId.current;
            const post: SocialPost = {
                post_id: tempId,
                content,
                likes: 0,
                liked: false,
                created_at: new Date().toISOString(),
                author: {
                    user_id: profile?.uid ?? "",
                    username: profile?.username ?? "unknown",
                },
                topic_mk_id: topicMkId(postedTopic),
            };
            setCreated((current) => [...current, post]);

            function dropTemp() {
                setCreated((current) =>
                    current.filter((item) => item.post_id !== tempId),
                );
            }

            void createPost({
                content,
                ...topicCreateFields(postedTopic),
            })
                .then((post_id) => {
                    if (post_id == null) {
                        dropTemp();
                        showToast("Couldn't publish your post.");
                        return;
                    }
                    setCreated((current) =>
                        current.map((item) =>
                            item.post_id === tempId
                                ? { ...item, post_id }
                                : item,
                        ),
                    );
                    void refreshTopicPosts();
                })
                .catch(() => {
                    dropTemp();
                    showToast("Couldn't publish your post.");
                });
        },
        [
            createPost,
            profile?.uid,
            profile?.username,
            refreshTopicPosts,
            showToast,
            topic,
        ],
    );

    const reload = useCallback(async () => {
        setRefreshing(true);
        try {
            await refreshTopicPosts();
        } finally {
            setRefreshing(false);
        }
    }, [refreshTopicPosts]);

    const loading = rankedPosts.length === 0 && topicPostsLoading;
    const emptyLabel = loading
        ? "Loading posts..."
        : topicPostsErr
          ? "Couldn't load posts."
          : "No posts yet.";

    return (
        <View className="flex-1">
            <ScrollView
                contentContainerClassName="gap-4 px-6 pt-4"
                contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={() => void reload()}
                        tintColor={colors.text}
                        colors={[colors.text]}
                        progressBackgroundColor={colors.card}
                    />
                }
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <View className="flex-row items-center justify-between gap-3">
                    <View className="min-w-0 flex-1">
                        <Text className="text-2xl font-bold text-foreground">
                            Posts about this song
                        </Text>
                        <Text
                            className="mt-0.5 text-base text-muted-foreground"
                            numberOfLines={1}
                        >
                            {focusedSong.title}
                        </Text>
                    </View>
                    <GlassIconButton
                        accessibilityLabel="Create a post"
                        onPress={() => setComposeOpen(true)}
                    >
                        <Ionicons name="add" size={24} color={colors.text} />
                    </GlassIconButton>
                </View>

                {!enabled ? null : rankedPosts.length === 0 ? (
                    <Text className="py-10 text-center text-muted-foreground">
                        {emptyLabel}
                    </Text>
                ) : (
                    <View className="gap-3">
                        {rankedPosts.map((post) => (
                            <PostCard
                                key={post.post_id}
                                post={post}
                                showTopic={false}
                                onLikedChange={rememberLike}
                            />
                        ))}
                    </View>
                )}
            </ScrollView>

            <CreatePostDialog
                open={composeOpen}
                onOpenChange={setComposeOpen}
                onCreate={handleCreate}
                lockedTopic={topic}
            />

            {toast ? (
                <View
                    pointerEvents="none"
                    accessibilityRole="alert"
                    className="absolute left-5 right-5 top-3 rounded-2xl bg-destructive px-4 py-3"
                >
                    <Text className="text-center text-sm text-white">
                        {toast}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

/** Most liked first. Equal likes fall back to newest, then post id. */
function byLikesThenNewest(a: SocialPost, b: SocialPost): number {
    if (a.likes !== b.likes) return b.likes - a.likes;
    if (a.created_at !== b.created_at) {
        return a.created_at < b.created_at ? 1 : -1;
    }
    return b.post_id - a.post_id;
}

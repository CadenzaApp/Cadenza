import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useNavigation } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    View,
    type ListRenderItem,
    type ViewToken,
} from "react-native";
import Animated from "react-native-reanimated";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
import { useProfile } from "@/lib/routes/profile";
import {
    useCreatePost,
    useFeed,
    useMarkPostsViewed,
} from "@/lib/routes/social";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { stopTopicPreview } from "@/lib/topic-preview";
import { useTopRailInset } from "@/lib/top-rail";

import { CreatePostDialog } from "./CreatePostDialog";
import { PostCard } from "./PostCard";
import { topicCreateFields, topicMkId } from "./topic";
import type { PostTopic, SocialPost } from "./types";

const VIEWABILITY_CONFIG = {
    itemVisiblePercentThreshold: 50,
};

/** How often pending view marks are flushed to the API. */
const MARK_VIEWED_FLUSH_MS = 3000;

/**
 * The Social tab. Loads the ranked feed with full post payloads.
 * A post you just wrote stays at the top until the feed includes it.
 * Posts that are at least half-visible are queued and marked viewed in
 * batches every few seconds.
 */
export function SocialFeedScreen() {
    const { listBottomInset } = useScreenOverlayInsets();
    const railInset = useTopRailInset() ?? 0;
    const scroll = useScreenScroll<FlatList<FeedRow>>();
    const navigation = useNavigation();
    const { colors } = useTheme();
    const {
        posts,
        unseenCount,
        showingSeen,
        hasNextPage,
        isLoadingNextPage,
        loadNextPage,
        refreshFeed,
        feedLoading,
        feedErr,
    } = useFeed();
    const { createPost } = useCreatePost();
    const { markPostsViewed } = useMarkPostsViewed();
    const { profile } = useProfile();
    const markedViewedIds = useRef(new Set<number>());
    const pendingViewedIds = useRef(new Set<number>());
    const markPostsViewedRef = useRef(markPostsViewed);
    markPostsViewedRef.current = markPostsViewed;

    const flushPendingViewed = useCallback(() => {
        if (pendingViewedIds.current.size === 0) return;
        const ids = [...pendingViewedIds.current];
        pendingViewedIds.current.clear();
        void markPostsViewedRef.current(ids).catch(() => {
            for (const id of ids) markedViewedIds.current.delete(id);
        });
    }, []);

    useEffect(() => {
        const timer = setInterval(flushPendingViewed, MARK_VIEWED_FLUSH_MS);
        return () => {
            clearInterval(timer);
            flushPendingViewed();
        };
    }, [flushPendingViewed]);

    useFocusEffect(
        useCallback(() => {
            return () => {
                void stopTopicPreview();
            };
        }, []),
    );

    const [created, setCreated] = useState<SocialPost[]>([]);
    const [localTopics, setLocalTopics] = useState<Record<number, PostTopic>>(
        {},
    );
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

    const feed = useMemo((): FeedRow[] => {
        const loaded = new Set(posts.map((post) => post.post_id));
        const pending = created.filter((post) => !loaded.has(post.post_id));
        const rows: FeedRow[] = pending.map((post) => ({
            kind: "post",
            post,
        }));
        const unseenPosts = posts.slice(0, unseenCount);
        const seenPosts = posts.slice(unseenCount);
        for (const post of unseenPosts) {
            rows.push({ kind: "post", post });
        }
        // Never-loaded pages ran dry: separator, then exclude=none pages
        if (showingSeen && seenPosts.length > 0) {
            rows.push({ kind: "caught-up" });
        }
        for (const post of seenPosts) {
            rows.push({ kind: "post", post });
        }
        return rows;
    }, [created, posts, showingSeen, unseenCount]);

    useLayoutEffect(() => {
        navigation.setOptions({
            headerRight: () => (
                <GlassIconButton
                    accessibilityLabel="Create a new post"
                    onPress={() => setComposeOpen(true)}
                >
                    <Ionicons name="add" size={24} color={colors.text} />
                </GlassIconButton>
            ),
        });
    }, [navigation, colors.text]);

    const handleCreate = useCallback(
        (content: string, topic?: PostTopic | null) => {
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
                topic_mk_id: topic ? topicMkId(topic) : null,
                comment_count: 0,
            };
            setCreated((current) => [post, ...current]);
            if (topic) {
                setLocalTopics((current) => ({ ...current, [tempId]: topic }));
            }

            function dropTemp() {
                setCreated((current) =>
                    current.filter((item) => item.post_id !== tempId),
                );
                setLocalTopics((current) => {
                    const next = { ...current };
                    delete next[tempId];
                    return next;
                });
            }

            void createPost({
                content,
                ...(topic ? topicCreateFields(topic) : {}),
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
                    setLocalTopics((current) => {
                        const attached = current[tempId];
                        if (!attached) return current;
                        const next = { ...current };
                        delete next[tempId];
                        next[post_id] = attached;
                        return next;
                    });
                })
                .catch(() => {
                    dropTemp();
                    showToast("Couldn't publish your post.");
                });
        },
        [createPost, profile?.uid, profile?.username, showToast],
    );

    const reload = useCallback(async () => {
        setRefreshing(true);
        try {
            await refreshFeed();
        } finally {
            setRefreshing(false);
        }
    }, [refreshFeed]);

    const onViewableItemsChanged = useRef(
        ({ viewableItems }: { viewableItems: ViewToken[] }) => {
            for (const token of viewableItems) {
                const row = token.item as FeedRow | undefined;
                if (!token.isViewable || row?.kind !== "post") continue;
                const id = row.post.post_id;
                if (id <= 0 || markedViewedIds.current.has(id)) continue;
                markedViewedIds.current.add(id);
                pendingViewedIds.current.add(id);
            }
        },
    ).current;

    const keyExtractor = useCallback((item: FeedRow, index: number) => {
        return item.kind === "caught-up"
            ? "caught-up"
            : `${item.post.post_id}-${index}`;
    }, []);

    const renderItem = useCallback<ListRenderItem<FeedRow>>(
        ({ item }) => {
            if (item.kind === "caught-up") {
                return <CaughtUpSeparator />;
            }
            return (
                <PostCard
                    post={item.post}
                    topicHint={localTopics[item.post.post_id]}
                />
            );
        },
        [localTopics],
    );

    const onEndReached = useCallback(() => {
        if (hasNextPage && !isLoadingNextPage) {
            void loadNextPage();
        }
    }, [hasNextPage, isLoadingNextPage, loadNextPage]);

    const loading = feed.length === 0 && feedLoading;
    const emptyLabel = loading
        ? "Loading posts..."
        : feedErr
          ? "Couldn't load posts."
          : "No posts yet.";

    return (
        <View className="flex-1 bg-background">
            <ScreenScrollMarker>
                <Animated.FlatList
                    {...scroll}
                    className="flex-1"
                    data={feed}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={reload}
                            tintColor={colors.text}
                            colors={[colors.text]}
                            progressBackgroundColor={colors.card}
                            progressViewOffset={railInset}
                        />
                    }
                    keyExtractor={keyExtractor}
                    renderItem={renderItem}
                    onViewableItemsChanged={onViewableItemsChanged}
                    viewabilityConfig={VIEWABILITY_CONFIG}
                    ItemSeparatorComponent={PostSeparator}
                    contentContainerStyle={[
                        {
                            paddingTop: 8,
                            paddingHorizontal: 20,
                            // listBottomInset clears the tab bar, player, and a
                            // FAB-sized gap; add a little more so the last
                            // card's footer isn't clipped under the chrome
                            paddingBottom: listBottomInset + 48,
                        },
                        scroll.contentContainerStyle,
                    ]}
                    ListEmptyComponent={
                        <Text className="py-10 text-center text-muted-foreground">
                            {emptyLabel}
                        </Text>
                    }
                    ListFooterComponent={
                        isLoadingNextPage ? (
                            <View className="items-center py-4">
                                <ActivityIndicator color={colors.text} />
                            </View>
                        ) : (
                            <View className="h-5" />
                        )
                    }
                    onEndReached={onEndReached}
                    onEndReachedThreshold={1}
                    showsVerticalScrollIndicator={false}
                />
            </ScreenScrollMarker>

            <CreatePostDialog
                open={composeOpen}
                onOpenChange={setComposeOpen}
                onCreate={handleCreate}
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

type FeedRow = { kind: "post"; post: SocialPost } | { kind: "caught-up" };

function PostSeparator() {
    return <View className="h-3" />;
}

function CaughtUpSeparator() {
    return (
        <Text className="py-2 text-center text-sm text-muted-foreground">
            ----- No new posts, you&apos;re caught up! -----
        </Text>
    );
}

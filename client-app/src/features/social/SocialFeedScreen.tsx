import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
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
    Pressable,
    RefreshControl,
    View,
    type ListRenderItem,
    type ViewToken,
} from "react-native";
import Animated from "react-native-reanimated";

import { BottomRowActionBubble } from "@/components/custom/bottom-row-action-bubble";
import { ListDivider } from "@/components/custom/list-divider";
import { Toast, useToast } from "@/components/custom/toast";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { GlassPanel } from "@/components/ui/glass-panel";
import {
    SegmentedControl,
    type SegmentOption,
} from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { invalidateAPIData } from "@/lib/api-actions";
import { useProfile } from "@/lib/routes/profile";
import {
    useCreatePost,
    useFeed,
    useFriendsFeed,
    useMarkPostsViewed,
    useNotifications,
} from "@/lib/routes/social";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { useAppTheme } from "@/lib/theme";
import { stopTopicPreview } from "@/lib/topic-preview";
import { useTopRailInset } from "@/lib/top-rail";

import { CreatePostDialog } from "./CreatePostDialog";
import { ListeningNowStrip } from "./ListeningNow";
import { SocialHubCards } from "./SocialHubCards";
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
    const [filter, setFilter] = useState<FeedFilter>("for-you");
    const friendsFeed = useFriendsFeed(filter === "friends");
    const { createPost } = useCreatePost();
    const { markPostsViewed } = useMarkPostsViewed();
    const { notifications, invalidateNotifications } = useNotifications();
    const showRedDot = notifications.some((item) => item.unread);
    const { profile } = useProfile();
    const router = useRouter();
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
            void invalidateNotifications();
            return () => {
                void stopTopicPreview();
            };
        }, [invalidateNotifications]),
    );

    const [created, setCreated] = useState<SocialPost[]>([]);
    const [hiddenIds, setHiddenIds] = useState<ReadonlySet<number>>(
        () => new Set(),
    );
    const [localTopics, setLocalTopics] = useState<Record<number, PostTopic>>(
        {},
    );
    const [refreshing, setRefreshing] = useState(false);
    const [composeOpen, setComposeOpen] = useState(false);
    const openCompose = useCallback(() => setComposeOpen(true), []);
    const { toast, showToast } = useToast();

    const feed = useMemo((): FeedRow[] => {
        const loaded = new Set(posts.map((post) => post.post_id));
        const pending = created.filter(
            (post) => !loaded.has(post.post_id) && !hiddenIds.has(post.post_id),
        );
        const rows: FeedRow[] = pending.map((post) => ({
            kind: "post",
            post,
        }));
        const unseenPosts = posts.slice(0, unseenCount);
        const seenPosts = posts.slice(unseenCount);
        for (const post of unseenPosts) {
            if (hiddenIds.has(post.post_id)) continue;
            rows.push({ kind: "post", post });
        }
        // Never-loaded pages ran dry: separator, then exclude=none pages
        if (showingSeen && seenPosts.length > 0) {
            rows.push({ kind: "caught-up" });
        }
        for (const post of seenPosts) {
            if (hiddenIds.has(post.post_id)) continue;
            rows.push({ kind: "post", post });
        }
        return rows;
    }, [created, hiddenIds, posts, showingSeen, unseenCount]);

    useLayoutEffect(() => {
        navigation.setOptions({
            headerRight: () => (
                <View className="flex-row items-center gap-2">
                    <View>
                        <GlassIconButton
                            accessibilityLabel="Notifications"
                            onPress={() => router.push("/social/notifications")}
                        >
                            <Ionicons
                                name="notifications"
                                size={22}
                                color={colors.text}
                            />
                        </GlassIconButton>
                        {showRedDot ? (
                            <View
                                pointerEvents="none"
                                className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive"
                            />
                        ) : null}
                    </View>
                </View>
            ),
        });
    }, [navigation, colors.text, router, showRedDot]);

    const handleCreate = useCallback(
        async (content: string, topic?: PostTopic | null) => {
            let postId: number | undefined;
            try {
                postId = await createPost({
                    content,
                    ...(topic ? topicCreateFields(topic) : {}),
                });
            } catch (error) {
                console.error("Creating a post failed", error);
                throw error;
            }
            if (postId == null) {
                console.error("Creating a post failed");
                throw new Error("Creating a post failed");
            }
            const publishedId = postId;
            const post: SocialPost = {
                post_id: publishedId,
                content,
                likes: 0,
                liked: false,
                created_at: new Date().toISOString(),
                edited_at: null,
                author: {
                    user_id: profile?.uid ?? "",
                    username: profile?.username ?? "unknown",
                },
                topic_mk_id: topic ? topicMkId(topic) : null,
                shared_playlist: null,
                comment_count: 0,
            };
            setCreated((current) => [post, ...current]);
            if (topic) {
                setLocalTopics((current) => ({
                    ...current,
                    [publishedId]: topic,
                }));
            }
            showToast("Post published");
        },
        [createPost, profile?.uid, profile?.username, showToast],
    );

    const handleEdited = useCallback(
        (postId: number, content: string, editedAt: string | null) => {
            setCreated((current) =>
                current.map((item) =>
                    item.post_id === postId
                        ? { ...item, content, edited_at: editedAt }
                        : item,
                ),
            );
        },
        [],
    );

    const reload = useCallback(async () => {
        setRefreshing(true);
        try {
            // the cards and the listening row above the posts refresh with them
            await Promise.all([
                filter === "friends"
                    ? friendsFeed.refreshFriendsFeed()
                    : refreshFeed(),
                invalidateAPIData([
                    { path: "/social/friends" },
                    { path: "/listening/friends" },
                    { path: "/live-sessions/current" },
                ]),
            ]);
        } finally {
            setRefreshing(false);
        }
    }, [filter, friendsFeed, refreshFeed]);

    const onViewableItemsChanged = useRef(
        ({ viewableItems }: { viewableItems: ViewToken[] }) => {
            for (const token of viewableItems) {
                const row = token.item as FeedRow | undefined;
                if (!token.isViewable || row?.kind !== "post") continue;
                const id = row.post.post_id;
                if (markedViewedIds.current.has(id)) continue;
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

    const removedCreated = useRef(
        new Map<number, { post: SocialPost; topic?: PostTopic }>(),
    );

    const handleDeleted = useCallback((postId: number) => {
        setHiddenIds((current) => {
            if (current.has(postId)) return current;
            const next = new Set(current);
            next.add(postId);
            return next;
        });
        setCreated((current) => {
            const removed = current.find((item) => item.post_id === postId);
            if (!removed) return current;
            removedCreated.current.set(postId, { post: removed });
            return current.filter((item) => item.post_id !== postId);
        });
        setLocalTopics((current) => {
            if (!(postId in current)) return current;
            const saved = removedCreated.current.get(postId);
            if (saved) saved.topic = current[postId];
            const next = { ...current };
            delete next[postId];
            return next;
        });
    }, []);

    const handleDeleteFailed = useCallback(
        (postId: number) => {
            setHiddenIds((current) => {
                if (!current.has(postId)) return current;
                const next = new Set(current);
                next.delete(postId);
                return next;
            });
            const saved = removedCreated.current.get(postId);
            removedCreated.current.delete(postId);
            if (saved) {
                setCreated((current) =>
                    current.some((item) => item.post_id === postId)
                        ? current
                        : [saved.post, ...current],
                );
                if (saved.topic) {
                    const topic = saved.topic;
                    setLocalTopics((current) => ({
                        ...current,
                        [postId]: topic,
                    }));
                }
            }
            showToast("Couldn't delete your post.", true);
        },
        [showToast],
    );

    const renderItem = useCallback<ListRenderItem<FeedRow>>(
        ({ item }) => {
            if (item.kind === "caught-up") {
                return <ListDivider label="You're all caught up" />;
            }
            return (
                <PostCard
                    post={item.post}
                    topicHint={localTopics[item.post.post_id]}
                    onDeleted={handleDeleted}
                    onDeleteFailed={handleDeleteFailed}
                    onEdited={handleEdited}
                />
            );
        },
        [handleDeleteFailed, handleDeleted, handleEdited, localTopics],
    );

    const showingFriends = filter === "friends";
    const rows = useMemo(
        (): FeedRow[] =>
            showingFriends
                ? friendsFeed.friendsPosts
                      .filter((post) => !hiddenIds.has(post.post_id))
                      .map((post) => ({ kind: "post", post }))
                : feed,
        [feed, friendsFeed.friendsPosts, hiddenIds, showingFriends],
    );
    const pagingNext = showingFriends
        ? friendsFeed.isLoadingNextFriendsPage
        : isLoadingNextPage;

    const onEndReached = useCallback(() => {
        if (showingFriends) {
            if (
                friendsFeed.hasNextFriendsPage &&
                !friendsFeed.isLoadingNextFriendsPage
            ) {
                void friendsFeed.loadNextFriendsPage();
            }
            return;
        }
        if (hasNextPage && !isLoadingNextPage) {
            void loadNextPage();
        }
    }, [
        friendsFeed,
        hasNextPage,
        isLoadingNextPage,
        loadNextPage,
        showingFriends,
    ]);

    const loading =
        rows.length === 0 &&
        (showingFriends ? friendsFeed.friendsFeedLoading : feedLoading);
    const failed = showingFriends ? friendsFeed.friendsFeedErr : feedErr;
    const emptyLabel = loading
        ? "Loading posts..."
        : failed
          ? "Couldn't load posts."
          : showingFriends
            ? "Your friends have not posted yet."
            : "No posts yet.";

    return (
        <View className="flex-1 bg-background">
            <ScreenScrollMarker>
                <Animated.FlatList
                    {...scroll}
                    className="flex-1"
                    data={rows}
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
                    ListHeaderComponent={
                        <SocialFeedHeader
                            filter={filter}
                            onFilterChange={setFilter}
                            onCompose={openCompose}
                        />
                    }
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
                        pagingNext ? (
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

            <BottomRowActionBubble
                icon="create-outline"
                accessibilityLabel="Create a new post"
                expanded={composeOpen}
                onPress={openCompose}
            />
            <CreatePostDialog
                open={composeOpen}
                onOpenChange={setComposeOpen}
                onCreate={handleCreate}
            />

            <Toast toast={toast} />
        </View>
    );
}

type FeedRow = { kind: "post"; post: SocialPost } | { kind: "caught-up" };

function PostSeparator() {
    return <View className="h-3" />;
}

type FeedFilter = "for-you" | "friends";

const FEED_FILTERS: readonly SegmentOption<FeedFilter>[] = [
    { value: "for-you", label: "For you" },
    { value: "friends", label: "Friends" },
];

/**
 * Everything above the posts: the hub cards, the Listening now row, a prompt
 * that opens the new post sheet, and the For you / Friends filter.
 */
function SocialFeedHeader({
    filter,
    onFilterChange,
    onCompose,
}: {
    filter: FeedFilter;
    onFilterChange: (filter: FeedFilter) => void;
    onCompose: () => void;
}) {
    const { mutedForeground } = useAppTheme().colors;
    return (
        <View className="mb-3">
            <SocialHubCards />
            <ListeningNowStrip />
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create a new post"
                onPress={onCompose}
                className="mt-6 active:opacity-60"
            >
                <GlassPanel>
                    <View className="flex-row items-center gap-3 px-4 py-3">
                        <Ionicons
                            name="create-outline"
                            size={20}
                            color={mutedForeground}
                        />
                        <Text className="flex-1 text-base text-muted-foreground">
                            Share what you&apos;re listening to...
                        </Text>
                    </View>
                </GlassPanel>
            </Pressable>
            <View className="mt-4">
                <SegmentedControl
                    size="sm"
                    options={FEED_FILTERS}
                    value={filter}
                    onChange={onFilterChange}
                />
            </View>
        </View>
    );
}

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
    ScrollView,
    View,
    useWindowDimensions,
    type ListRenderItem,
    type ViewToken,
} from "react-native";
import Animated, {
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
    useComposedEventHandler,
    type SharedValue,
} from "react-native-reanimated";

import { BottomRowActionBubble } from "@/components/custom/bottom-row-action-bubble";
import { Toast, useToast } from "@/components/custom/toast";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { NebulaBackdrop } from "@/components/ui/nebula-backdrop";
import { Text } from "@/components/ui/text";
import { invalidateAPIData } from "@/lib/api-actions";
import { withAlpha } from "@/lib/artwork-color";
import { useProfile } from "@/lib/routes/profile";
import type { SharedPlaylistSummary } from "@/lib/routes/shared-playlists";
import {
    useFriendsListening,
    type FriendListening,
} from "@/lib/routes/listening";
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
import { stopTopicPreview } from "@/lib/topic-preview";
import { useTopRailInset } from "@/lib/top-rail";
import { useAppTheme } from "@/lib/theme";

import { InlinePostComposer } from "./InlinePostComposer";
import { ListeningNowStrip } from "./ListeningNow";
import { PostCard } from "./PostCard";
import { SocialOverflowMenu } from "./SocialOverflowMenu";
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
    const friendsScroll = useScreenScroll<FlatList<FeedRow>>();
    const pager = useRef<ScrollView>(null);
    const { width } = useWindowDimensions();
    const [headerHeight, setHeaderHeight] = useState(0);
    const forYouOffset = useSharedValue(0);
    const friendsOffset = useSharedValue(0);
    const trackForYouScroll = useAnimatedScrollHandler((event) => {
        forYouOffset.set(event.contentOffset.y);
    });
    const trackFriendsScroll = useAnimatedScrollHandler((event) => {
        friendsOffset.set(event.contentOffset.y);
    });
    const forYouScrollHandler = useComposedEventHandler([
        scroll.onScroll,
        trackForYouScroll,
    ]);
    const friendsScrollHandler = useComposedEventHandler([
        friendsScroll.onScroll,
        trackFriendsScroll,
    ]);
    const pageProgress = useSharedValue(0);
    const headerStyle = useAnimatedStyle(() => {
        const progress = Math.max(0, Math.min(1, pageProgress.get()));
        const left = Math.max(0, Math.min(headerHeight, forYouOffset.get()));
        const right = Math.max(0, Math.min(headerHeight, friendsOffset.get()));
        return {
            transform: [{ translateY: -(left + (right - left) * progress) }],
        };
    });
    const onPageScroll = useAnimatedScrollHandler((event) => {
        pageProgress.set(event.contentOffset.x / width);
    });
    const navigation = useNavigation();
    const { colors } = useTheme();
    const { brand } = useAppTheme().colors;
    const {
        posts,
        unseenCount,
        hasNextPage,
        isLoadingNextPage,
        loadNextPage,
        refreshFeed,
        feedLoading,
        feedErr,
    } = useFeed();
    const [filter, setFilter] = useState<FeedFilter>("for-you");
    const friendsFeed = useFriendsFeed(!feedLoading || filter === "friends");
    const { friendsListening } = useFriendsListening();
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
    const [socialMenuOpen, setSocialMenuOpen] = useState(false);
    const onComposeOpenChange = useCallback((open: boolean) => {
        setComposeOpen(open);
    }, []);
    const syncHeaderPosition = useCallback(() => {
        const offset = Math.max(
            0,
            Math.min(
                headerHeight,
                filter === "friends" ? friendsOffset.get() : forYouOffset.get(),
            ),
        );
        if (filter === "friends") {
            scroll.ref.current?.scrollToOffset({ offset, animated: false });
            forYouOffset.set(offset);
        } else {
            friendsScroll.ref.current?.scrollToOffset({
                offset,
                animated: false,
            });
            friendsOffset.set(offset);
        }
    }, [
        filter,
        headerHeight,
        friendsOffset,
        forYouOffset,
        scroll.ref,
        friendsScroll.ref,
    ]);
    const changeFeed = useCallback(
        (next: FeedFilter) => {
            syncHeaderPosition();
            pager.current?.scrollTo({
                x: next === "friends" ? width : 0,
                animated: true,
            });
            setFilter(next);
        },
        [width, syncHeaderPosition],
    );
    // BottomRowActionBubble registers this with shared chrome in a layout
    // effect. Keep its identity stable, or that registration itself loops.
    const toggleComposer = useCallback(() => {
        onComposeOpenChange(!composeOpen);
    }, [composeOpen, onComposeOpenChange]);
    const socialNebula = useMemo(() => [brand, "#7b61ff", "#20a9a0"], [brand]);
    const { toast, showToast } = useToast();

    const feed = useMemo((): FeedRow[] => {
        const loaded = new Set(posts.map((post) => post.post_id));
        const pending = created.filter(
            (post) => !loaded.has(post.post_id) && !hiddenIds.has(post.post_id),
        );
        const rows: FeedRow[] = pending.map((post) => ({
            kind: "post",
            post,
            unseen: true,
        }));
        const unseenPosts = posts.slice(0, unseenCount);
        const seenPosts = posts.slice(unseenCount);
        for (const post of unseenPosts) {
            if (hiddenIds.has(post.post_id)) continue;
            rows.push({ kind: "post", post, unseen: true });
        }
        for (const post of seenPosts) {
            if (hiddenIds.has(post.post_id)) continue;
            rows.push({ kind: "post", post });
        }
        return rows;
    }, [created, hiddenIds, posts, unseenCount]);

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
                    <GlassIconButton
                        accessibilityLabel="Social options"
                        onPress={() => setSocialMenuOpen(true)}
                    >
                        <Ionicons
                            name="ellipsis-horizontal"
                            size={22}
                            color={colors.text}
                        />
                    </GlassIconButton>
                </View>
            ),
        });
    }, [navigation, colors.text, router, showRedDot]);

    const handleCreate = useCallback(
        async (
            content: string,
            topic?: PostTopic | null,
            playlist?: SharedPlaylistSummary | null,
        ) => {
            let postId: number | undefined;
            try {
                postId = await createPost({
                    content,
                    ...(playlist
                        ? { shared_playlist_id: playlist.playlist_id }
                        : topic
                          ? topicCreateFields(topic)
                          : {}),
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
                topic_mk_id: playlist || !topic ? null : topicMkId(topic),
                shared_playlist: playlist
                    ? {
                          playlist_id: playlist.playlist_id,
                          name: playlist.name,
                          song_count: playlist.song_count,
                          member_count: playlist.member_count,
                          cover_song_ids: playlist.cover_song_ids,
                          available: true,
                      }
                    : null,
                comment_count: 0,
            };
            setCreated((current) => [post, ...current]);
            if (topic && !playlist) {
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
        return `${item.post.post_id}-${index}`;
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

    const listeningByUser = useMemo(
        () =>
            new Map<string, FriendListening>(
                (friendsListening ?? []).map((friend) => [
                    friend.user_id,
                    friend,
                ]),
            ),
        [friendsListening],
    );

    const renderItem = useCallback<ListRenderItem<FeedRow>>(
        ({ item }) => {
            return (
                <PostCard
                    post={item.post}
                    authorListening={listeningByUser.get(
                        item.post.author.user_id,
                    )}
                    unseen={item.unseen}
                    topicHint={localTopics[item.post.post_id]}
                    onDeleted={handleDeleted}
                    onDeleteFailed={handleDeleteFailed}
                    onEdited={handleEdited}
                />
            );
        },
        [
            handleDeleteFailed,
            handleDeleted,
            handleEdited,
            listeningByUser,
            localTopics,
        ],
    );

    const showingFriends = filter === "friends";
    const friendRows = useMemo(
        (): FeedRow[] =>
            friendsFeed.friendsPosts
                .filter((post) => !hiddenIds.has(post.post_id))
                .map((post) => ({ kind: "post", post })),
        [friendsFeed.friendsPosts, hiddenIds],
    );

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

    return (
        <View className="flex-1 bg-background">
            <NebulaBackdrop colors={socialNebula} layout="float" />
            <Animated.View
                pointerEvents="box-none"
                className="absolute left-0 right-0 top-0 z-10"
                onLayout={(event) =>
                    setHeaderHeight(event.nativeEvent.layout.height)
                }
                style={[
                    scroll.contentContainerStyle,
                    { paddingHorizontal: 20, paddingBottom: 4 },
                    headerStyle,
                ]}
            >
                <SocialFeedHeader
                    filter={filter}
                    onFilterChange={changeFeed}
                    progress={pageProgress}
                />
            </Animated.View>
            <ScreenScrollMarker>
                <Animated.ScrollView
                    ref={pager}
                    onScroll={onPageScroll}
                    onScrollBeginDrag={syncHeaderPosition}
                    scrollEventThrottle={16}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    bounces={false}
                    onMomentumScrollEnd={(event) =>
                        setFilter(
                            event.nativeEvent.contentOffset.x >= width / 2
                                ? "friends"
                                : "for-you",
                        )
                    }
                >
                    {(["for-you", "friends"] as const).map((page) => {
                        const isFriends = page === "friends";
                        const rows = isFriends ? friendRows : feed;
                        const pageScroll = isFriends ? friendsScroll : scroll;
                        const loading =
                            rows.length === 0 &&
                            (isFriends
                                ? friendsFeed.friendsFeedLoading
                                : feedLoading);
                        const failed = isFriends
                            ? friendsFeed.friendsFeedErr
                            : feedErr;
                        const emptyLabel = loading
                            ? "Loading posts..."
                            : failed
                              ? "Couldn't load posts."
                              : isFriends
                                ? "Your friends have not posted yet."
                                : "No posts yet.";
                        const pagingNext = isFriends
                            ? friendsFeed.isLoadingNextFriendsPage
                            : isLoadingNextPage;
                        return (
                            <View key={page} style={{ width, flex: 1 }}>
                                <Animated.FlatList
                                    {...pageScroll}
                                    onScroll={
                                        isFriends
                                            ? friendsScrollHandler
                                            : forYouScrollHandler
                                    }
                                    className="flex-1"
                                    data={rows}
                                    refreshControl={
                                        <RefreshControl
                                            refreshing={refreshing}
                                            onRefresh={reload}
                                            tintColor={colors.text}
                                            colors={[colors.text]}
                                            progressBackgroundColor={
                                                colors.card
                                            }
                                            progressViewOffset={railInset}
                                        />
                                    }
                                    keyExtractor={keyExtractor}
                                    renderItem={renderItem}
                                    onViewableItemsChanged={
                                        isFriends
                                            ? undefined
                                            : onViewableItemsChanged
                                    }
                                    viewabilityConfig={VIEWABILITY_CONFIG}
                                    ItemSeparatorComponent={PostSeparator}
                                    keyboardShouldPersistTaps="handled"
                                    contentContainerStyle={[
                                        {
                                            paddingTop: headerHeight + 8,
                                            paddingHorizontal: 20,
                                            // listBottomInset clears the tab bar, player, and a
                                            // FAB-sized gap; add a little more so the last
                                            // card's footer isn't clipped under the chrome
                                            paddingBottom: listBottomInset + 48,
                                        },
                                    ]}
                                    ListEmptyComponent={
                                        <Text className="py-10 text-center text-muted-foreground">
                                            {emptyLabel}
                                        </Text>
                                    }
                                    ListFooterComponent={
                                        pagingNext ? (
                                            <View className="items-center py-4">
                                                <ActivityIndicator
                                                    color={colors.text}
                                                />
                                            </View>
                                        ) : (
                                            <View className="h-5" />
                                        )
                                    }
                                    onEndReached={
                                        page === filter
                                            ? onEndReached
                                            : undefined
                                    }
                                    onEndReachedThreshold={1}
                                    showsVerticalScrollIndicator={false}
                                />
                            </View>
                        );
                    })}
                </Animated.ScrollView>
            </ScreenScrollMarker>

            <BottomRowActionBubble
                icon="create-outline"
                accessibilityLabel="Create a new post"
                expanded={composeOpen}
                onPress={toggleComposer}
            />
            <InlinePostComposer
                open={composeOpen}
                onOpenChange={onComposeOpenChange}
                onCreate={handleCreate}
            />
            <SocialOverflowMenu
                open={socialMenuOpen}
                onClose={() => setSocialMenuOpen(false)}
                onStartSession={() =>
                    router.push("/live-session/new?openPlayer=1")
                }
                onJoinSession={() => router.push("/join")}
            />
            <Toast toast={toast} />
        </View>
    );
}

type FeedRow = { kind: "post"; post: SocialPost; unseen?: boolean };

function PostSeparator() {
    return null;
}

type FeedFilter = "for-you" | "friends";

/**
 * Everything above the posts: a compact Listening now story row and the
 * feed's X-style tab switcher.
 */
function SocialFeedHeader({
    filter,
    onFilterChange,
    progress,
}: {
    filter: FeedFilter;
    onFilterChange: (filter: FeedFilter) => void;
    progress: SharedValue<number>;
}) {
    const { mutedForeground } = useAppTheme().colors;
    const [tabWidth, setTabWidth] = useState(0);
    const indicatorStyle = useAnimatedStyle(() => ({
        transform: [
            {
                translateX:
                    (Math.max(0, Math.min(1, progress.get())) * tabWidth) / 2,
            },
        ],
    }));
    return (
        <View className="mb-1">
            <ListeningNowStrip />
            <View
                className="mt-1 flex-row border-b pb-1"
                onLayout={(event) =>
                    setTabWidth(event.nativeEvent.layout.width)
                }
                style={{ borderBottomColor: withAlpha(mutedForeground, 0.55) }}
            >
                <FeedTab
                    label="For you"
                    active={filter === "for-you"}
                    onPress={() => onFilterChange("for-you")}
                />
                <Animated.View
                    pointerEvents="none"
                    className="absolute bottom-0 left-0 h-1 w-1/2 rounded-full bg-brand"
                    style={indicatorStyle}
                />
                <FeedTab
                    label="Friends"
                    active={filter === "friends"}
                    onPress={() => onFilterChange("friends")}
                />
            </View>
        </View>
    );
}

function FeedTab({
    label,
    active,
    onPress,
}: {
    label: string;
    active: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            className="flex-1"
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={onPress}
        >
            <Text
                selectable={false}
                className={
                    active
                        ? "py-3 text-center font-semibold text-foreground"
                        : "py-3 text-center font-semibold text-muted-foreground"
                }
            >
                {label}
            </Text>
        </Pressable>
    );
}

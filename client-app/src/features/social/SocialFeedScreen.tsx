import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { useIsFocused, useTheme } from "expo-router/react-navigation";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
    type Ref,
} from "react";
import {
    ActivityIndicator,
    AppState,
    FlatList,
    RefreshControl,
    ScrollView,
    useWindowDimensions,
    View,
    type ListRenderItem,
    type ViewToken,
} from "react-native";
import Animated, {
    useAnimatedScrollHandler,
    useAnimatedReaction,
    useComposedEventHandler,
    useAnimatedStyle,
    useSharedValue,
    type SharedValue,
} from "react-native-reanimated";

import { useToast } from "@/components/custom/toast";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { NebulaBackdrop } from "@/components/ui/nebula-backdrop";
import { Text } from "@/components/ui/text";
import { invalidateAPIData } from "@/lib/api-actions";
import { useKeyboardScroll } from "@/lib/keyboard-scroll";
import { SlidingTabStrip } from "@/components/ui/sliding-tab-pager";
import { useProfile } from "@/lib/routes/profile";
import type { SharedPlaylistSummary } from "@/lib/routes/shared-playlists";
import { type FriendListening } from "@/lib/routes/listening";
import { useFriendsListeningShared } from "@/lib/routes/listening-provider";
import {
    useCreatePost,
    useFeed,
    useFriendsFeed,
    useMarkPostsViewed,
    useNotifications,
    useHiddenSpotlights,
} from "@/lib/routes/social";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { stopTopicPreview } from "@/lib/topic-preview";
import { useTopRailInset } from "@/lib/top-rail";
import { useAppTheme } from "@/lib/theme";

import { COMPOSER_LAYOUT, InlinePostComposer } from "./InlinePostComposer";
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
 * A post you just wrote stays at the top until a reload clears it.
 * Posts at least half on screen are queued only while this tab is focused
 * and the app is in the foreground, then marked viewed in batches. Posts
 * under Previously viewed are left alone. Discuss, a profile, and a topic
 * page leave view status alone too.
 */
export function SocialFeedScreen() {
    const pager = useRef<ScrollView>(null);
    const forYouPage = useRef<FeedPageHandle>(null);
    const friendsPage = useRef<FeedPageHandle>(null);
    const railInset = useTopRailInset() ?? 16;
    const [headerHeight, setHeaderHeight] = useState(0);
    const [composerY, setComposerY] = useState(0);
    const headerOffset = useSharedValue(0);
    const headerStyle = useAnimatedStyle(() => ({
        transform: [
            {
                translateY: -Math.min(
                    headerHeight,
                    Math.max(0, headerOffset.get()),
                ),
            },
        ],
    }));
    const { width: windowWidth } = useWindowDimensions();
    const [layoutWidth, setLayoutWidth] = useState(0);
    const pageWidth = layoutWidth || windowWidth;
    const navigation = useNavigation();
    const isFocused = useIsFocused();
    const { colors } = useTheme();
    const { brand } = useAppTheme().colors;
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
    const { hiddenSpotlightIds } = useHiddenSpotlights();
    const [unavailableSpotlights, setUnavailableSpotlights] = useState<
        Set<number>
    >(() => new Set());
    const hideUnavailableSpotlight = useCallback((postId: number) => {
        setUnavailableSpotlights((current) => {
            if (current.has(postId)) return current;
            return new Set([...current, postId]);
        });
    }, []);
    const tabProgress = useSharedValue(0);
    const filterRef = useRef(filter);
    const onPageScroll = useAnimatedScrollHandler((event) => {
        tabProgress.set(event.contentOffset.x / pageWidth);
    });
    useEffect(() => {
        pager.current?.scrollTo({
            x: filterRef.current === "friends" ? pageWidth : 0,
            animated: false,
        });
    }, [pageWidth]);
    const friendsFeed = useFriendsFeed(!feedLoading || filter === "friends");
    const { friendsListening } = useFriendsListeningShared();
    const { createPost } = useCreatePost();
    const { markPostsViewed } = useMarkPostsViewed();
    const { notifications, invalidateNotifications } = useNotifications();
    const showRedDot = notifications.some((item) => item.unread);
    const { profile } = useProfile();
    const router = useRouter();
    const markedViewedIds = useRef(new Set<number>());
    const pendingViewedIds = useRef<number[]>([]);
    const viewablePostIds = useRef(new Set<number>());
    const feedPostIdsRef = useRef<number[]>([]);
    const screenVisibleRef = useRef(false);
    const markPostsViewedRef = useRef(markPostsViewed);
    useEffect(() => {
        markPostsViewedRef.current = markPostsViewed;
    }, [markPostsViewed]);

    const queueViewablePosts = useCallback(() => {
        if (!screenVisibleRef.current || filterRef.current !== "for-you")
            return;
        for (const id of viewablePostIds.current) {
            if (markedViewedIds.current.has(id)) continue;
            markedViewedIds.current.add(id);
            pendingViewedIds.current.push(id);
        }
    }, []);
    const queueViewablePostsRef = useRef(queueViewablePosts);
    useEffect(() => {
        queueViewablePostsRef.current = queueViewablePosts;
    }, [queueViewablePosts]);

    useEffect(() => {
        const sync = () => {
            screenVisibleRef.current =
                isFocused && AppState.currentState === "active";
            if (screenVisibleRef.current) queueViewablePosts();
        };
        sync();
        const subscription = AppState.addEventListener("change", sync);
        return () => subscription.remove();
    }, [isFocused, queueViewablePosts]);

    const flushPendingViewed = useCallback(() => {
        if (pendingViewedIds.current.length === 0) return;
        const pending = pendingViewedIds.current;
        pendingViewedIds.current = [];
        const order = feedPostIdsRef.current;
        const ids = [...pending].sort((a, b) => {
            const ai = order.indexOf(a);
            const bi = order.indexOf(b);
            return (
                (ai === -1 ? order.length : ai) -
                (bi === -1 ? order.length : bi)
            );
        });
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
    const [refreshing, setRefreshing] = useState<ReadonlySet<FeedFilter>>(
        () => new Set(),
    );
    const [socialMenuOpen, setSocialMenuOpen] = useState(false);
    const syncFeedHeaders = useCallback(() => {
        const collapse = Math.min(
            headerHeight,
            Math.max(0, headerOffset.get()),
        );
        forYouPage.current?.syncHeader(collapse);
        friendsPage.current?.syncHeader(collapse);
    }, [headerHeight, headerOffset]);
    const changeFeed = useCallback(
        (next: FeedFilter) => {
            filterRef.current = next;
            syncFeedHeaders();
            setFilter(next);
            pager.current?.scrollTo({
                x: next === "friends" ? pageWidth : 0,
                animated: true,
            });
        },
        [pageWidth, syncFeedHeaders],
    );
    const socialNebula = useMemo(() => [brand, "#7b61ff", "#20a9a0"], [brand]);
    const { showToast } = useToast();

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
        // Fresh pages ran dry: a heading, then previously viewed posts.
        if (showingSeen && seenPosts.length > 0) {
            rows.push({ kind: "history-heading" });
        }
        for (const post of seenPosts) {
            if (hiddenIds.has(post.post_id)) continue;
            rows.push({ kind: "post", post, history: true });
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
            tags?: { text: string; color: string }[],
        ) => {
            let created:
                | { post_id: number; tags: SocialPost["tags"] }
                | undefined;
            try {
                created = await createPost({
                    content,
                    ...(playlist
                        ? { shared_playlist_id: playlist.playlist_id }
                        : topic
                          ? topicCreateFields(topic)
                          : {}),
                    tags: tags?.map(({ text, color }) => ({ text, color })),
                });
            } catch (error) {
                console.error("Creating a post failed", error);
                throw error;
            }
            if (created?.post_id == null) {
                console.error("Creating a post failed");
                throw new Error("Creating a post failed");
            }
            const publishedId = created.post_id;
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
                tags: created.tags ?? [],
            };
            setCreated((current) => [post, ...current]);
            if (topic && !playlist) {
                setLocalTopics((current) => ({
                    ...current,
                    [publishedId]: topic,
                }));
            }
            showToast("Post published", undefined, "success");
        },
        [createPost, profile?.uid, profile?.username, showToast],
    );

    const handleEdited = useCallback(
        (
            postId: number,
            content: string,
            editedAt: string | null,
            tags?: SocialPost["tags"],
        ) => {
            setCreated((current) =>
                current.map((item) =>
                    item.post_id === postId
                        ? {
                              ...item,
                              content,
                              edited_at: editedAt,
                              ...(tags !== undefined ? { tags } : {}),
                          }
                        : item,
                ),
            );
        },
        [],
    );

    const reload = useCallback(
        async (page: FeedFilter) => {
            setRefreshing((current) => new Set([...current, page]));
            setCreated([]);
            setUnavailableSpotlights(new Set());
            try {
                // the cards and the listening row above the posts refresh with them
                await Promise.all([
                    page === "friends"
                        ? friendsFeed.refreshFriendsFeed()
                        : refreshFeed(),
                    invalidateAPIData([
                        { path: "/social/friends" },
                        { path: "/listening/friends" },
                        { path: "/live-sessions/current" },
                    ]),
                ]);
            } finally {
                setRefreshing((current) => {
                    const next = new Set(current);
                    next.delete(page);
                    return next;
                });
            }
        },
        [friendsFeed, refreshFeed],
    );

    const onViewableItemsChanged = useCallback(
        ({ viewableItems }: { viewableItems: ViewToken[] }) => {
            if (filterRef.current !== "for-you") return;
            const next = new Set<number>();
            for (const token of viewableItems) {
                const row = token.item as FeedRow | undefined;
                if (!token.isViewable || row?.kind !== "post" || row.history)
                    continue;
                next.add(row.post.post_id);
            }
            viewablePostIds.current = next;
            queueViewablePostsRef.current();
        },
        [],
    );

    const keyExtractor = useCallback(
        (item: FeedRow) =>
            item.kind === "history-heading"
                ? "history-heading"
                : String(item.post.post_id),
        [],
    );

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
            showToast("Couldn't delete your post.", undefined, "error");
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
            if (item.kind === "history-heading") {
                return <PreviouslyViewedHeading />;
            }
            return (
                <PostCard
                    post={item.post}
                    authorListening={
                        item.post.author
                            ? listeningByUser.get(item.post.author.user_id)
                            : undefined
                    }
                    unseen={item.unseen}
                    divider={item.divider}
                    topicHint={localTopics[item.post.post_id]}
                    onDeleted={handleDeleted}
                    onDeleteFailed={handleDeleteFailed}
                    onUnavailable={hideUnavailableSpotlight}
                    onEdited={handleEdited}
                />
            );
        },
        [
            handleDeleteFailed,
            hideUnavailableSpotlight,
            handleDeleted,
            handleEdited,
            listeningByUser,
            localTopics,
        ],
    );

    const friendRows = useMemo(
        (): FeedRow[] =>
            friendsFeed.friendsPosts
                .filter((post) => !hiddenIds.has(post.post_id))
                .map((post) => ({ kind: "post", post })),
        [friendsFeed.friendsPosts, hiddenIds],
    );
    const pageRows = useMemo(() => {
        const visible = (items: FeedRow[]) =>
            withoutLinesAroundSpotlights(
                items.filter(
                    (row) =>
                        row.kind !== "post" ||
                        (!unavailableSpotlights.has(row.post.post_id) &&
                            !hiddenSpotlightIds.has(row.post.post_id)),
                ),
            );
        return { "for-you": visible(feed), friends: visible(friendRows) };
    }, [feed, friendRows, unavailableSpotlights, hiddenSpotlightIds]);
    useEffect(() => {
        feedPostIdsRef.current = pageRows["for-you"].flatMap((row) =>
            row.kind === "post" && !row.history ? [row.post.post_id] : [],
        );
    }, [pageRows]);

    const onEndReached = useCallback(
        (page: FeedFilter) => {
            if (page === "friends") {
                if (
                    friendsFeed.hasNextFriendsPage &&
                    !friendsFeed.isLoadingNextFriendsPage
                ) {
                    void friendsFeed.loadNextFriendsPage();
                }
            } else if (hasNextPage && !isLoadingNextPage) {
                void loadNextPage();
            }
        },
        [friendsFeed, hasNextPage, isLoadingNextPage, loadNextPage],
    );

    return (
        <View className="flex-1 overflow-hidden bg-background">
            {/* fixed to the screen, so the feed slides over it */}
            <NebulaBackdrop colors={socialNebula} layout="float" />
            <Animated.ScrollView
                ref={pager}
                className="flex-1"
                style={{ opacity: headerHeight > 0 ? 1 : 0 }}
                horizontal
                pagingEnabled
                directionalLockEnabled
                bounces={false}
                removeClippedSubviews={false}
                showsHorizontalScrollIndicator={false}
                onLayout={(event) =>
                    setLayoutWidth(event.nativeEvent.layout.width)
                }
                onScroll={onPageScroll}
                onScrollBeginDrag={syncFeedHeaders}
                scrollEventThrottle={16}
                onMomentumScrollEnd={(event) => {
                    const next =
                        event.nativeEvent.contentOffset.x >= pageWidth / 2
                            ? "friends"
                            : "for-you";
                    filterRef.current = next;
                    setFilter(next);
                }}
            >
                {FEED_TABS.map(({ value: page }) => (
                    <View key={page} style={{ width: pageWidth }}>
                        <FeedPage
                            page={page}
                            active={filter === page}
                            rows={pageRows[page]}
                            loading={
                                page === "friends"
                                    ? friendsFeed.friendsFeedLoading
                                    : feedLoading
                            }
                            failed={Boolean(
                                page === "friends"
                                    ? friendsFeed.friendsFeedErr
                                    : feedErr,
                            )}
                            pagingNext={
                                page === "friends"
                                    ? friendsFeed.isLoadingNextFriendsPage
                                    : isLoadingNextPage
                            }
                            refreshing={refreshing.has(page)}
                            onRefresh={() => void reload(page)}
                            onEndReached={() => onEndReached(page)}
                            renderItem={renderItem}
                            keyExtractor={keyExtractor}
                            onViewableItemsChanged={
                                page === "for-you"
                                    ? onViewableItemsChanged
                                    : undefined
                            }
                            ref={page === "friends" ? friendsPage : forYouPage}
                            headerHeight={headerHeight}
                            headerOffset={headerOffset}
                        />
                    </View>
                ))}
            </Animated.ScrollView>

            <Animated.View
                className="absolute left-0 right-0 top-0 px-5 pb-3"
                style={[{ paddingTop: railInset }, headerStyle]}
                onLayout={(event) =>
                    setHeaderHeight(event.nativeEvent.layout.height)
                }
            >
                <SocialFeedHeader
                    filter={filter}
                    onFilterChange={changeFeed}
                    progress={tabProgress}
                />
                <View
                    onLayout={(event) =>
                        setComposerY(event.nativeEvent.layout.y)
                    }
                >
                    <InlinePostComposer
                        onCreate={handleCreate}
                        onOpen={() => {
                            const page =
                                filter === "friends" ? friendsPage : forYouPage;
                            page.current?.scrollToComposer(
                                Math.max(0, composerY - railInset),
                            );
                        }}
                    />
                </View>
            </Animated.View>

            <SocialOverflowMenu
                open={socialMenuOpen}
                onClose={() => setSocialMenuOpen(false)}
            />
        </View>
    );
}

const FEED_TABS = [
    { value: "for-you", label: "For you" },
    { value: "friends", label: "Friends" },
] as const;

type FeedPageHandle = {
    scrollToComposer: (offset: number) => void;
    syncHeader: (collapse: number) => void;
};

/** Only post lists live inside the horizontal pager. */
function FeedPage({
    page,
    active,
    rows,
    loading,
    failed,
    pagingNext,
    refreshing,
    onRefresh,
    onEndReached,
    renderItem,
    keyExtractor,
    onViewableItemsChanged,
    ref,
    headerHeight,
    headerOffset,
}: {
    page: FeedFilter;
    active: boolean;
    rows: FeedRow[];
    loading: boolean;
    failed: boolean;
    pagingNext: boolean;
    refreshing: boolean;
    onRefresh: () => void;
    onEndReached: () => void;
    renderItem: ListRenderItem<FeedRow>;
    keyExtractor: (item: FeedRow, index: number) => string;
    onViewableItemsChanged?: (info: { viewableItems: ViewToken[] }) => void;
    ref: Ref<FeedPageHandle>;
    headerHeight: number;
    headerOffset: SharedValue<number>;
}) {
    const { listBottomInset } = useScreenOverlayInsets();
    const railInset = useTopRailInset() ?? 0;
    const scroll = useScreenScroll<FlatList<FeedRow>>(active);
    const { colors } = useTheme();
    const keyboardScroll = useKeyboardScroll(scroll.ref);
    const offset = useSharedValue(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    useImperativeHandle(
        ref,
        () => ({
            scrollToComposer: keyboardScroll,
            syncHeader: (collapse: number) => {
                // A deeply scrolled feed keeps its place while the header is
                // collapsed. Otherwise both lists share the visible header offset.
                if (offset.get() < headerHeight || collapse < headerHeight) {
                    offset.set(collapse);
                    scroll.ref.current?.scrollToOffset({
                        offset: collapse,
                        animated: false,
                    });
                }
            },
        }),
        [keyboardScroll, headerHeight, offset, scroll.ref],
    );
    const trackHeader = useAnimatedScrollHandler((event) => {
        offset.set(event.contentOffset.y);
        if (active) headerOffset.set(event.contentOffset.y);
    });
    const onScroll = useComposedEventHandler([scroll.onScroll, trackHeader]);
    useAnimatedReaction(
        () => active,
        (next) => {
            if (next) headerOffset.set(offset.get());
        },
        [active],
    );
    const emptyLabel = loading
        ? "Loading posts..."
        : failed
          ? "Couldn't load posts."
          : page === "friends"
            ? "Your friends have not posted yet."
            : "No posts yet.";
    return (
        <ScreenScrollMarker>
            <Animated.FlatList
                {...scroll}
                onScroll={onScroll}
                scrollsToTop={active}
                onLayout={(event) =>
                    setViewportHeight(event.nativeEvent.layout.height)
                }
                className="flex-1"
                data={rows}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
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
                // the posts slide as the composer above them opens
                itemLayoutAnimation={COMPOSER_LAYOUT}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={[
                    {
                        paddingTop: headerHeight,
                        minHeight: viewportHeight + headerHeight,
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
                            <ActivityIndicator color={colors.text} />
                        </View>
                    ) : (
                        <View className="h-5" />
                    )
                }
                onEndReached={active ? onEndReached : undefined}
                onEndReachedThreshold={1}
                showsVerticalScrollIndicator={false}
            />
        </ScreenScrollMarker>
    );
}

type FeedRow =
    | {
          kind: "post";
          post: SocialPost;
          history?: boolean;
          unseen?: boolean;
          /** False for the post just above a spotlight. */
          divider?: boolean;
      }
    | { kind: "history-heading" };

function PreviouslyViewedHeading() {
    return (
        <Text className="px-1 pt-1 text-sm font-semibold text-foreground">
            Previously viewed
        </Text>
    );
}

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
    return (
        <View className="mb-5">
            <ListeningNowStrip />
            <View className="mt-1">
                <SlidingTabStrip
                    options={FEED_TABS}
                    value={filter}
                    onChange={onFilterChange}
                    progress={progress}
                />
            </View>
        </View>
    );
}
function withoutLinesAroundSpotlights(rows: FeedRow[]): FeedRow[] {
    return rows.map((row, index) => {
        const next = rows[index + 1];
        return row.kind === "post"
            ? {
                  ...row,
                  divider: next?.kind !== "post" || next.post.author != null,
              }
            : row;
    });
}

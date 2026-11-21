import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { useIsFocused, useTheme } from "expo-router/react-navigation";
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
    AppState,
    FlatList,
    Pressable,
    RefreshControl,
    View,
    type ListRenderItem,
    type ViewToken,
} from "react-native";
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";

import { useToast } from "@/components/custom/toast";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { NebulaBackdrop } from "@/components/ui/nebula-backdrop";
import { Text } from "@/components/ui/text";
import { invalidateAPIData } from "@/lib/api-actions";
import { useKeyboardScroll } from "@/lib/keyboard-scroll";
import { withAlpha } from "@/lib/artwork-color";
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
import { useHiddenSpotlights } from "@/lib/routes/social";
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
    const { listBottomInset } = useScreenOverlayInsets();
    const railInset = useTopRailInset() ?? 0;
    const scroll = useScreenScroll<FlatList<FeedRow>>();
    // the strip and the tabs above the composer, for scrolling to it
    const [headerHeight, setHeaderHeight] = useState(0);
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
    useEffect(() => {
        tabProgress.set(
            withTiming(filter === "friends" ? 1 : 0, { duration: 200 }),
        );
    }, [filter, tabProgress]);
    // viewability is read through a ref: FlatList does not allow swapping
    // `onViewableItemsChanged` after mount
    const filterRef = useRef(filter);
    useEffect(() => {
        filterRef.current = filter;
    }, [filter]);
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
    markPostsViewedRef.current = markPostsViewed;

    const queueViewablePosts = useCallback(() => {
        if (!screenVisibleRef.current) return;
        for (const id of viewablePostIds.current) {
            if (markedViewedIds.current.has(id)) continue;
            markedViewedIds.current.add(id);
            pendingViewedIds.current.push(id);
        }
    }, []);
    const queueViewablePostsRef = useRef(queueViewablePosts);
    queueViewablePostsRef.current = queueViewablePosts;

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
    const [refreshing, setRefreshing] = useState(false);
    const [socialMenuOpen, setSocialMenuOpen] = useState(false);
    const keyboardScroll = useKeyboardScroll(scroll.ref);
    // the keyboard carries the composer up until its top is just under the
    // top rail, the strip and tabs scrolled away above it
    const scrollToComposer = useCallback(() => {
        keyboardScroll(headerHeight);
    }, [keyboardScroll, headerHeight]);
    const changeFeed = useCallback((next: FeedFilter) => {
        setFilter(next);
    }, []);
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

    const reload = useCallback(async () => {
        setRefreshing(true);
        setCreated([]);
        setUnavailableSpotlights(new Set());
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
    ).current;

    const keyExtractor = useCallback((item: FeedRow, index: number) => {
        if (item.kind === "history-heading") return "history-heading";
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

    const showingFriends = filter === "friends";
    const friendRows = useMemo(
        (): FeedRow[] =>
            friendsFeed.friendsPosts
                .filter((post) => !hiddenIds.has(post.post_id))
                .map((post) => ({ kind: "post", post })),
        [friendsFeed.friendsPosts, hiddenIds],
    );
    const rows = useMemo(
        () =>
            withoutLinesAroundSpotlights(
                (showingFriends ? friendRows : feed).filter(
                    (row) =>
                        row.kind !== "post" ||
                        (!unavailableSpotlights.has(row.post.post_id) &&
                            !hiddenSpotlightIds.has(row.post.post_id)),
                ),
            ),
        [
            showingFriends,
            friendRows,
            feed,
            unavailableSpotlights,
            hiddenSpotlightIds,
        ],
    );
    feedPostIdsRef.current = rows.flatMap((row) =>
        row.kind === "post" && !row.history ? [row.post.post_id] : [],
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
        if (rows.length === 0) return;
        if (hasNextPage && !isLoadingNextPage) {
            void loadNextPage();
        }
    }, [
        friendsFeed,
        hasNextPage,
        isLoadingNextPage,
        loadNextPage,
        rows.length,
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
    const pagingNext = showingFriends
        ? friendsFeed.isLoadingNextFriendsPage
        : isLoadingNextPage;

    return (
        <View className="flex-1 bg-background">
            {/* fixed to the screen, so the feed slides over it */}
            <NebulaBackdrop colors={socialNebula} layout="float" />
            {/* the marker takes the list alone, like Analytics: the strip,
                tabs, and composer scroll inside it as its header, so the
                native top blur and the refresh spinner both follow the list */}
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
                    // Rows slide when a spotlight is removed or the composer opens.
                    itemLayoutAnimation={COMPOSER_LAYOUT}
                    ListHeaderComponent={
                        <View className="mb-3">
                            <View
                                onLayout={(event) =>
                                    setHeaderHeight(
                                        event.nativeEvent.layout.height,
                                    )
                                }
                            >
                                <SocialFeedHeader
                                    filter={filter}
                                    onFilterChange={changeFeed}
                                    progress={tabProgress}
                                />
                            </View>
                            <InlinePostComposer
                                onOpen={scrollToComposer}
                                onCreate={handleCreate}
                            />
                        </View>
                    }
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={[
                        {
                            paddingTop: 16,
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

            <SocialOverflowMenu
                open={socialMenuOpen}
                onClose={() => setSocialMenuOpen(false)}
            />
        </View>
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

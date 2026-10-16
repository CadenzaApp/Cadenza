import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation, useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { FlatList, RefreshControl, View } from "react-native";
import Animated from "react-native-reanimated";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
import { invalidateAPIData } from "@/lib/api-actions";
import { useProfile } from "@/lib/routes/profile";
import {
    useCreatePost,
    useFeed,
    useLikePost,
    usePosts,
    useUnlikePost,
} from "@/lib/routes/social";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { useTopRailInset } from "@/lib/top-rail";

import { CreatePostDialog } from "./CreatePostDialog";
import { PostCard } from "./PostCard";
import type { SocialPost } from "./types";

/**
 * The Social tab. Loads the ranked feed, then the posts themselves.
 * A post you just wrote stays at the top until the feed includes it.
 */
export function SocialFeedScreen() {
    const { listBottomInset } = useScreenOverlayInsets();
    const railInset = useTopRailInset() ?? 0;
    const scroll = useScreenScroll<FlatList<SocialPost>>();
    const navigation = useNavigation();
    const router = useRouter();
    const { colors } = useTheme();
    const { postIds, feedLoading, feedErr } = useFeed();
    const { posts, postsLoading, postsErr } = usePosts(postIds);
    const { createPost } = useCreatePost();
    const { likePost } = useLikePost();
    const { unlikePost } = useUnlikePost();
    const { profile } = useProfile();

    const [created, setCreated] = useState<SocialPost[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [composeOpen, setComposeOpen] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const nextTempId = useRef(0);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [likedOverride, setLikedOverride] = useState<ReadonlyMap<number, boolean>>(
        () => new Map(),
    );
    const likedOverrideRef = useRef(likedOverride);
    likedOverrideRef.current = likedOverride;

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

    const feed = useMemo(() => {
        const loaded = new Set(posts.map((post) => post.post_id));
        return [...created.filter((post) => !loaded.has(post.post_id)), ...posts];
    }, [created, posts]);

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

    const toggleLike = useCallback(
        (post: SocialPost) => {
            const current =
                likedOverrideRef.current.get(post.post_id) ?? post.liked;
            const nowLiked = !current;
            const next = new Map(likedOverrideRef.current);
            next.set(post.post_id, nowLiked);
            likedOverrideRef.current = next;
            setLikedOverride(next);
            if (post.post_id < 0) return;
            const request = nowLiked
                ? likePost(post.post_id)
                : unlikePost(post.post_id);
            void request.catch(() => {
                if (likedOverrideRef.current.get(post.post_id) !== nowLiked) {
                    return;
                }
                const rolled = new Map(likedOverrideRef.current);
                rolled.delete(post.post_id);
                likedOverrideRef.current = rolled;
                setLikedOverride(rolled);
            });
        },
        [likePost, unlikePost],
    );

    const handleCreate = useCallback(
        (content: string) => {
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
            };
            setCreated((current) => [post, ...current]);

            function dropTemp() {
                setCreated((current) =>
                    current.filter((item) => item.post_id !== tempId),
                );
                if (!likedOverrideRef.current.has(tempId)) return;
                const next = new Map(likedOverrideRef.current);
                next.delete(tempId);
                likedOverrideRef.current = next;
                setLikedOverride(next);
            }

            void createPost({ content })
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
                    if (!likedOverrideRef.current.has(tempId)) return;
                    const liked = likedOverrideRef.current.get(tempId)!;
                    const next = new Map(likedOverrideRef.current);
                    next.delete(tempId);
                    next.set(post_id, liked);
                    likedOverrideRef.current = next;
                    setLikedOverride(next);
                    if (!liked) return;
                    void likePost(post_id).catch(() => {
                        if (likedOverrideRef.current.get(post_id) !== true) {
                            return;
                        }
                        const rolled = new Map(likedOverrideRef.current);
                        rolled.delete(post_id);
                        likedOverrideRef.current = rolled;
                        setLikedOverride(rolled);
                    });
                })
                .catch(() => {
                    dropTemp();
                    showToast("Couldn't publish your post.");
                });
        },
        [createPost, likePost, profile?.uid, profile?.username, showToast],
    );

    const openAuthor = useCallback(
        (authorId: string) => {
            if (!authorId) return;
            router.push(`/social/user/${authorId}`);
        },
        [router],
    );

    const reload = useCallback(async () => {
        setRefreshing(true);
        try {
            await invalidateAPIData([
                { path: "/social/feed" },
                { path: "/social/posts/batch" },
            ]);
        } finally {
            setRefreshing(false);
        }
    }, []);

    const loading =
        feed.length === 0 && (feedLoading || (postIds.length > 0 && postsLoading));
    const emptyLabel = loading
        ? "Loading posts..."
        : feedErr || postsErr
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
                    keyExtractor={(post) => String(post.post_id)}
                    renderItem={({ item }) => {
                        const liked =
                            likedOverride.get(item.post_id) ?? item.liked;
                        const likes =
                            item.likes +
                            (liked ? 1 : 0) -
                            (item.liked ? 1 : 0);
                        return (
                            <PostCard
                                post={{ ...item, likes }}
                                liked={liked}
                                onToggleLike={() => toggleLike(item)}
                                onPressAuthor={() =>
                                    openAuthor(item.author.user_id)
                                }
                            />
                        );
                    }}
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

function PostSeparator() {
    return <View className="h-3" />;
}

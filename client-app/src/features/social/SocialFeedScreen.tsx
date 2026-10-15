import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FlatList, View } from "react-native";
import Animated from "react-native-reanimated";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
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

import { CreatePostDialog } from "./CreatePostDialog";
import { PostCard } from "./PostCard";
import type { SocialPost } from "./types";

/**
 * The Social tab. Loads the ranked feed, then the posts themselves.
 * A post you just wrote stays at the top until the feed includes it.
 */
export function SocialFeedScreen() {
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll<FlatList<SocialPost>>();
    const navigation = useNavigation();
    const { colors } = useTheme();
    const { postIds, feedLoading, feedErr } = useFeed();
    const { posts, postsLoading, postsErr } = usePosts(postIds);
    const { createPost } = useCreatePost();
    const { likePost } = useLikePost();
    const { unlikePost } = useUnlikePost();
    const { profile } = useProfile();

    const [created, setCreated] = useState<SocialPost[]>([]);
    const [composeOpen, setComposeOpen] = useState(false);
    const [likedOverride, setLikedOverride] = useState<ReadonlyMap<number, boolean>>(
        () => new Map(),
    );
    const likedOverrideRef = useRef(likedOverride);
    likedOverrideRef.current = likedOverride;

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
        async (content: string) => {
            const post_id = await createPost({ content });
            if (post_id == null) return;
            const post: SocialPost = {
                post_id,
                content,
                likes: 0,
                liked: false,
                created_at: new Date().toISOString(),
                author: { username: profile?.username ?? "unknown" },
            };
            setCreated((current) => [post, ...current]);
        },
        [createPost, profile?.username],
    );

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
        </View>
    );
}

function PostSeparator() {
    return <View className="h-3" />;
}

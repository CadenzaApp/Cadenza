import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { FlatList, View } from "react-native";
import Animated from "react-native-reanimated";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
import { useProfile } from "@/lib/routes/profile";
import { useCreatePost, useLikePost, useUnlikePost } from "@/lib/routes/social";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";

import { CreatePostDialog } from "./CreatePostDialog";
import { MOCK_FEED } from "./mock-feed";
import { PostCard } from "./PostCard";
import type { SocialPost } from "./types";

/**
 * The Social tab's feed. Posts come from mock data for now; swapping in a
 * `/social/feed` hook later should only change where `posts` is sourced.
 */
export function SocialFeedScreen() {
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll<FlatList<SocialPost>>();
    const navigation = useNavigation();
    const { colors } = useTheme();
    const { createPost } = useCreatePost();
    const { likePost } = useLikePost();
    const { unlikePost } = useUnlikePost();
    const { profile } = useProfile();

    const [posts, setPosts] = useState<SocialPost[]>(() => MOCK_FEED);
    const [composeOpen, setComposeOpen] = useState(false);
    const [likedIds, setLikedIds] = useState<ReadonlySet<number>>(
        () => new Set(),
    );
    const likedIdsRef = useRef(likedIds);
    likedIdsRef.current = likedIds;

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
        (postId: number) => {
            const nowLiked = !likedIdsRef.current.has(postId);
            const next = new Set(likedIdsRef.current);
            if (nowLiked) next.add(postId);
            else next.delete(postId);
            likedIdsRef.current = next;
            setLikedIds(next);
            const request = nowLiked ? likePost(postId) : unlikePost(postId);
            void request.catch(() => {
                if (likedIdsRef.current.has(postId) !== nowLiked) return;
                const rolled = new Set(likedIdsRef.current);
                if (nowLiked) rolled.delete(postId);
                else rolled.add(postId);
                likedIdsRef.current = rolled;
                setLikedIds(rolled);
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
                created_at: new Date().toISOString(),
                author: { username: profile?.username ?? "unknown" },
            };
            setPosts((current) => [post, ...current]);
        },
        [createPost, profile?.username],
    );

    return (
        <View className="flex-1 bg-background">
            <ScreenScrollMarker>
                <Animated.FlatList
                    {...scroll}
                    className="flex-1"
                    data={posts}
                    keyExtractor={(post) => String(post.post_id)}
                    renderItem={({ item }) => (
                        <PostCard
                            post={item}
                            liked={likedIds.has(item.post_id)}
                            onToggleLike={() => toggleLike(item.post_id)}
                        />
                    )}
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
                            No posts yet.
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

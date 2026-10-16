import { useNavigation } from "expo-router";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { FlatList, View } from "react-native";
import Animated from "react-native-reanimated";

import { Text } from "@/components/ui/text";
import {
    useLikePost,
    useUnlikePost,
    useUserPosts,
} from "@/lib/routes/social";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";

import { initialsFromUsername } from "./format";
import { PostCard } from "./PostCard";
import type { SocialPost } from "./types";

type Props = {
    userId: string;
};

/**
 * One user's public profile: avatar, username, bio, then their posts newest
 * first. Opened by tapping an author on the feed.
 */
export function UserProfileScreen({ userId }: Props) {
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll<FlatList<SocialPost>>();
    const navigation = useNavigation();
    const { profile, posts, userPostsLoading, userPostsErr } =
        useUserPosts(userId);
    const { likePost } = useLikePost();
    const { unlikePost } = useUnlikePost();

    const [likedOverride, setLikedOverride] = useState<
        ReadonlyMap<number, boolean>
    >(() => new Map());
    const likedOverrideRef = useRef(likedOverride);
    likedOverrideRef.current = likedOverride;

    useLayoutEffect(() => {
        navigation.setOptions({
            title: profile?.username ?? "Profile",
        });
    }, [navigation, profile?.username]);

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

    const loading = userPostsLoading && posts.length === 0;
    const emptyLabel = loading
        ? "Loading posts..."
        : userPostsErr
          ? "Couldn't load posts."
          : "No posts yet.";

    return (
        <View className="flex-1 bg-background">
            <ScreenScrollMarker>
                <Animated.FlatList
                    {...scroll}
                    className="flex-1"
                    data={posts}
                    keyExtractor={(post) => String(post.post_id)}
                    ListHeaderComponent={
                        <ProfileHeader
                            username={profile?.username}
                            bio={profile?.bio}
                            loading={userPostsLoading && !profile}
                        />
                    }
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
        </View>
    );
}

function ProfileHeader({
    username,
    bio,
    loading,
}: {
    username?: string;
    bio?: string;
    loading: boolean;
}) {
    if (loading) {
        return (
            <View className="mb-4 gap-3 py-2">
                <Text className="text-muted-foreground">Loading profile...</Text>
            </View>
        );
    }

    const name = username ?? "unknown";
    const trimmedBio = bio?.trim() ?? "";

    return (
        <View className="mb-4 gap-3 border-b border-border pb-5 pt-2">
            <View className="flex-row items-center gap-3">
                <View className="h-14 w-14 items-center justify-center rounded-full bg-muted">
                    <Text className="text-base font-semibold text-foreground">
                        {initialsFromUsername(name)}
                    </Text>
                </View>
                <Text
                    className="min-w-0 flex-1 text-xl font-semibold text-foreground"
                    numberOfLines={1}
                >
                    {name}
                </Text>
            </View>
            {trimmedBio ? (
                <Text className="text-base leading-6 text-foreground">
                    {trimmedBio}
                </Text>
            ) : (
                <Text className="text-sm text-muted-foreground">No bio yet.</Text>
            )}
        </View>
    );
}

function PostSeparator() {
    return <View className="h-3" />;
}

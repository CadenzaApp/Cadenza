import { useNavigation, useRouter, type Href } from "expo-router";
import { useCallback, useLayoutEffect } from "react";
import { FlatList, Pressable, View, type ListRenderItem } from "react-native";
import Animated from "react-native-reanimated";

import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useUserPosts } from "@/lib/routes/social";
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
 * first. Opened by tapping an author on the feed, the feed's Me button,
 * account details, or from Discuss, which closes itself and lands here on the
 * Social tab. Read only: on your own page, Edit opens account
 * details, the one place a username and bio are edited.
 */
export function UserProfileScreen({ userId }: Props) {
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll<FlatList<SocialPost>>();
    const navigation = useNavigation();
    const router = useRouter();
    const { account } = useAccount();
    const { profile, posts, userPostsLoading, userPostsErr } =
        useUserPosts(userId);

    const username = profile?.username;
    const bio = profile?.bio;

    useLayoutEffect(() => {
        navigation.setOptions({
            title: username ?? "Profile",
        });
    }, [navigation, username]);

    const renderItem = useCallback<ListRenderItem<SocialPost>>(
        ({ item }) => <PostCard post={item} />,
        [],
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
                    keyboardShouldPersistTaps="handled"
                    keyExtractor={(post) => String(post.post_id)}
                    ListHeaderComponent={
                        <ProfileHeader
                            username={username}
                            bio={bio}
                            loading={userPostsLoading && !profile}
                            canEdit={account?.id === userId}
                            onEdit={() =>
                                router.push("/account-details" as Href)
                            }
                        />
                    }
                    renderItem={renderItem}
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
    canEdit,
    onEdit,
}: {
    username?: string;
    bio?: string;
    loading: boolean;
    canEdit: boolean;
    onEdit: () => void;
}) {
    if (loading) {
        return (
            <View className="mb-4 gap-3 py-2">
                <Text className="text-muted-foreground">
                    Loading profile...
                </Text>
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
                {canEdit ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Edit profile"
                        hitSlop={8}
                        onPress={onEdit}
                        className="active:opacity-60"
                    >
                        <Text className="text-sm font-semibold text-primary">
                            Edit
                        </Text>
                    </Pressable>
                ) : null}
            </View>
            {trimmedBio ? (
                <Text className="text-base leading-6 text-foreground">
                    {trimmedBio}
                </Text>
            ) : (
                <Text className="text-sm text-muted-foreground">
                    No bio yet.
                </Text>
            )}
        </View>
    );
}

function PostSeparator() {
    return <View className="h-3" />;
}

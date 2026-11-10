import { useNavigation, useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { FlatList, Pressable, View, type ListRenderItem } from "react-native";
import Animated from "react-native-reanimated";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import {
    useCancelFriendRequest,
    useRequestFriend,
    useUserPosts,
} from "@/lib/routes/social";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";

import { initialsFromUsername } from "./format";
import { ProfileListening } from "./ListeningNow";
import { PostCard } from "./PostCard";
import type { SocialPost } from "./types";

type Props = {
    userId: string;
};

/**
 * One user's public profile: avatar, username, bio, then their posts newest
 * first. Opened by tapping an author on the feed, the feed's Me button,
 * account details, or from Discuss, which closes itself and lands here on the
 * Social tab. On your own page, Edit opens account details, the one place
 * a username and bio are edited. Under the avatar and username is how many
 * friends they have. On someone else's page, Add friend sits on that same
 * row. Already friends says Unfriend, and tapping it deletes that row. A
 * request already sent says Friend request sent, and tapping it cancels.
 * A request they already sent says Accept friend request, and tapping it
 * accepts.
 */
export function UserProfileScreen({ userId }: Props) {
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll<FlatList<SocialPost>>();
    const navigation = useNavigation();
    const router = useRouter();
    const { account } = useAccount();
    const { profile, posts, userPostsLoading, userPostsErr } =
        useUserPosts(userId);
    const { requestFriend, requestFriendLoading } = useRequestFriend();
    const { cancelFriendRequest, cancelFriendRequestLoading } =
        useCancelFriendRequest();
    const [sentTo, setSentTo] = useState<string | null>(null);
    const [clearedFor, setClearedFor] = useState<string | null>(null);
    const [unfriendedFor, setUnfriendedFor] = useState<string | null>(null);
    const [acceptedFor, setAcceptedFor] = useState<string | null>(null);

    useEffect(() => {
        if (
            unfriendedFor === userId &&
            profile != null &&
            profile.is_friend === false
        ) {
            setUnfriendedFor(null);
        }
    }, [profile, unfriendedFor, userId]);

    useEffect(() => {
        if (
            acceptedFor === userId &&
            profile != null &&
            profile.is_friend === true
        ) {
            setAcceptedFor(null);
        }
    }, [acceptedFor, profile, userId]);

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
                        <View>
                            <ProfileHeader
                                username={username}
                                bio={bio}
                                loading={userPostsLoading && !profile}
                                canEdit={account?.id === userId}
                                friendCount={profile?.friend_count ?? 0}
                                canAddFriend={
                                    account != null && account.id !== userId
                                }
                                isFriend={
                                    unfriendedFor !== userId &&
                                    (acceptedFor === userId ||
                                        profile?.is_friend === true)
                                }
                                requestReceived={
                                    acceptedFor !== userId &&
                                    unfriendedFor !== userId &&
                                    profile?.friend_request_received === true
                                }
                                requestSent={
                                    clearedFor !== userId &&
                                    acceptedFor !== userId &&
                                    (sentTo === userId ||
                                        (unfriendedFor !== userId &&
                                            profile?.friend_request_sent ===
                                                true))
                                }
                                requestBusy={
                                    requestFriendLoading ||
                                    cancelFriendRequestLoading
                                }
                                onAcceptRequest={() => {
                                    setAcceptedFor(userId);
                                    void requestFriend({
                                        user_id: userId,
                                    }).catch(() =>
                                        setAcceptedFor((current) =>
                                            current === userId ? null : current,
                                        ),
                                    );
                                }}
                                onAddFriend={() => {
                                    setClearedFor((current) =>
                                        current === userId ? null : current,
                                    );
                                    setSentTo(userId);
                                    void requestFriend({
                                        user_id: userId,
                                    }).catch(() =>
                                        setSentTo((current) =>
                                            current === userId ? null : current,
                                        ),
                                    );
                                }}
                                onCancelFriend={() => {
                                    setSentTo((current) =>
                                        current === userId ? null : current,
                                    );
                                    setClearedFor(userId);
                                    void cancelFriendRequest({
                                        user_id: userId,
                                    }).catch(() =>
                                        setClearedFor((current) =>
                                            current === userId ? null : current,
                                        ),
                                    );
                                }}
                                onUnfriend={() => {
                                    setSentTo((current) =>
                                        current === userId ? null : current,
                                    );
                                    setAcceptedFor((current) =>
                                        current === userId ? null : current,
                                    );
                                    setUnfriendedFor(userId);
                                    void cancelFriendRequest({
                                        user_id: userId,
                                    }).catch(() =>
                                        setUnfriendedFor((current) =>
                                            current === userId ? null : current,
                                        ),
                                    );
                                }}
                                onEdit={() =>
                                    router.push("/account-details" as Href)
                                }
                            />
                            <ProfileListening userId={userId} />
                        </View>
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
    friendCount,
    canEdit,
    canAddFriend,
    isFriend,
    requestReceived,
    requestSent,
    requestBusy,
    onAddFriend,
    onAcceptRequest,
    onCancelFriend,
    onUnfriend,
    onEdit,
}: {
    username?: string;
    bio?: string;
    loading: boolean;
    friendCount: number;
    canEdit: boolean;
    canAddFriend: boolean;
    isFriend: boolean;
    requestReceived: boolean;
    requestSent: boolean;
    requestBusy: boolean;
    onAddFriend: () => void;
    onAcceptRequest: () => void;
    onCancelFriend: () => void;
    onUnfriend: () => void;
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
    const friendLabel = isFriend
        ? "Unfriend"
        : requestSent
          ? "Friend request sent"
          : requestReceived
            ? "Accept friend request"
            : "Add friend";
    const onFriendPress = isFriend
        ? onUnfriend
        : requestSent
          ? onCancelFriend
          : requestReceived
            ? onAcceptRequest
            : onAddFriend;

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
            <View className="flex-row items-center gap-3">
                {canAddFriend ? (
                    <Button
                        accessibilityLabel={friendLabel}
                        className="self-start"
                        size="sm"
                        variant="outline"
                        disabled={requestBusy}
                        onPress={onFriendPress}
                    >
                        <Text>{friendLabel}</Text>
                    </Button>
                ) : null}
                <Text className="text-sm text-muted-foreground">
                    {friendCount === 1 ? "1 friend" : `${friendCount} friends`}
                </Text>
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

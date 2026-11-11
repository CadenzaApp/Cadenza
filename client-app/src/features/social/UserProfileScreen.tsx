import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation, useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { FlatList, Pressable, View, type ListRenderItem } from "react-native";
import Animated from "react-native-reanimated";

import { Toast, useToast } from "@/components/custom/toast";
import { Button } from "@/components/ui/button";
import { GlassConfirmDialog } from "@/components/ui/glass-confirm-dialog";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import {
    useBlockUser,
    useCancelFriendRequest,
    useFavoriteFriend,
    useRequestFriend,
    useUserPosts,
} from "@/lib/routes/social";
import { useAppTheme } from "@/lib/theme";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";

import { FriendOptionsMenu, type FriendMenuTarget } from "./FriendOptionsMenu";
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
 * row. Already friends says Friends with a chevron, which opens a menu:
 * favorite, unfriend, block. A request already sent says Friend request
 * sent, and tapping it cancels. A request they already sent says Accept
 * friend request, and tapping it accepts. Anyone not a friend also gets a
 * "..." with Block. An account you blocked says Unblock and shows no posts.
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
    const [menuFor, setMenuFor] = useState<FriendMenuTarget | null>(null);
    const [confirmBlock, setConfirmBlock] = useState(false);
    const { setFavorite } = useFavoriteFriend();
    const { setBlocked, blockLoading } = useBlockUser();
    const { toast, showToast } = useToast();

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

    const isFriend =
        unfriendedFor !== userId &&
        (acceptedFor === userId || profile?.is_friend === true);

    const unfriend = () => {
        setSentTo((current) => (current === userId ? null : current));
        setAcceptedFor((current) => (current === userId ? null : current));
        setUnfriendedFor(userId);
        void cancelFriendRequest({ user_id: userId }).catch(() =>
            setUnfriendedFor((current) =>
                current === userId ? null : current,
            ),
        );
    };

    const block = async () => {
        try {
            await setBlocked(userId, true);
            setSentTo(null);
            setAcceptedFor(null);
            setConfirmBlock(false);
            showToast(`Blocked ${username ?? "them"}`);
        } catch {
            showToast("Couldn't block this account.", true);
        }
    };

    const unblock = async () => {
        try {
            await setBlocked(userId, false);
            showToast(`Unblocked ${username ?? "them"}`);
        } catch {
            showToast("Couldn't unblock this account.", true);
        }
    };

    const setFavoriteFor = async (favorite: boolean) => {
        try {
            await setFavorite(userId, favorite);
        } catch {
            showToast("Couldn't update favorites.", true);
        }
    };

    const loading = userPostsLoading && posts.length === 0;
    const emptyLabel = profile?.blocked
        ? "You blocked this account."
        : loading
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
                                isFriend={isFriend}
                                blocked={profile?.blocked === true}
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
                                onOpenMenu={() =>
                                    setMenuFor({
                                        user_id: userId,
                                        username: username ?? "unknown",
                                        isFriend,
                                        isFavorite:
                                            isFriend &&
                                            profile?.is_favorite === true,
                                    })
                                }
                                onUnblock={() => void unblock()}
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
            <FriendOptionsMenu
                target={menuFor}
                onClose={() => setMenuFor(null)}
                onFavorite={(favorite) => void setFavoriteFor(favorite)}
                onUnfriend={unfriend}
                onBlock={() => setConfirmBlock(true)}
            />
            <GlassConfirmDialog
                open={confirmBlock}
                title={`Block ${username ?? "this account"}?`}
                description="This ends your friendship and any request between you. Neither of you will see the other's posts, and they can't send you a friend request. They won't be told."
                confirmLabel="Block"
                pendingLabel="Blocking..."
                pending={blockLoading}
                onOpenChange={setConfirmBlock}
                onConfirm={() => void block()}
            />
            <Toast toast={toast} />
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
    blocked,
    requestReceived,
    requestSent,
    requestBusy,
    onAddFriend,
    onAcceptRequest,
    onCancelFriend,
    onOpenMenu,
    onUnblock,
    onEdit,
}: {
    username?: string;
    bio?: string;
    loading: boolean;
    friendCount: number;
    canEdit: boolean;
    canAddFriend: boolean;
    isFriend: boolean;
    blocked: boolean;
    requestReceived: boolean;
    requestSent: boolean;
    requestBusy: boolean;
    onAddFriend: () => void;
    onAcceptRequest: () => void;
    onCancelFriend: () => void;
    /** Friends: favorite, unfriend, block. Anyone else: block. */
    onOpenMenu: () => void;
    onUnblock: () => void;
    onEdit: () => void;
}) {
    const { foreground } = useAppTheme().colors;
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
    const friendLabel = requestSent
        ? "Friend request sent"
        : requestReceived
          ? "Accept friend request"
          : "Add friend";
    const onFriendPress = requestSent
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
                {!canAddFriend ? null : blocked ? (
                    <Button
                        accessibilityLabel={`Unblock ${name}`}
                        className="self-start"
                        size="sm"
                        variant="outline"
                        onPress={onUnblock}
                    >
                        <Text>Unblock</Text>
                    </Button>
                ) : isFriend ? (
                    <Button
                        accessibilityLabel="Friends, options"
                        className="flex-row items-center gap-1 self-start"
                        size="sm"
                        variant="outline"
                        disabled={requestBusy}
                        onPress={onOpenMenu}
                    >
                        <Text>Friends</Text>
                        <Ionicons
                            name="chevron-down"
                            size={14}
                            color={foreground}
                        />
                    </Button>
                ) : (
                    <>
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
                        <Button
                            accessibilityLabel={`More options for ${name}`}
                            className="w-9 self-start px-0"
                            size="sm"
                            variant="outline"
                            onPress={onOpenMenu}
                        >
                            <Ionicons
                                name="ellipsis-horizontal"
                                size={16}
                                color={foreground}
                            />
                        </Button>
                    </>
                )}
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

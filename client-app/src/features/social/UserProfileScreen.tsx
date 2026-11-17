import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation, useRouter, type Href } from "expo-router";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useState,
} from "react";
import { FlatList, Pressable, View, type ListRenderItem } from "react-native";
import Animated from "react-native-reanimated";

import { Toast, useToast } from "@/components/custom/toast";
import { Button } from "@/components/ui/button";
import { GlassConfirmDialog } from "@/components/ui/glass-confirm-dialog";
import {
    SegmentedControl,
    type SegmentOption,
} from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import {
    useBlockUser,
    useCancelFriendRequest,
    useFavoriteFriend,
    usePost,
    useRequestFriend,
    useUserPosts,
    useUserReplies,
} from "@/lib/routes/social";
import { useAppTheme } from "@/lib/theme";
import type { SocialReply } from "@/lib/types";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";

import { FriendOptionsMenu, type FriendMenuTarget } from "./FriendOptionsMenu";
import { formatRelativeTime, initialsFromUsername } from "./format";
import { ProfileListening } from "./ListeningNow";
import { PostCard } from "./PostCard";
import { PostCommentsDialog } from "./PostCommentsDialog";
import { ProfileShelves } from "./ProfileShelves";
import type { SocialPost } from "./types";

type Props = {
    userId: string;
};

type ProfileTab = "posts" | "replies";

const PROFILE_TABS: readonly SegmentOption<ProfileTab>[] = [
    { value: "posts", label: "Posts" },
    { value: "replies", label: "Replies" },
];

type ProfileRow =
    | { kind: "post"; post: SocialPost }
    | { kind: "reply"; reply: SocialReply };

/**
 * One user's public profile: avatar, username, bio, what they are playing and
 * their recent plays, their shared playlists and shared queries, then their
 * posts or their replies, newest first, picked by a Posts / Replies switch.
 * Each part above the posts shows as their privacy settings allow. Tapping a
 * reply opens its post's comments. Opened by tapping an author on the feed,
 * the feed's My profile card, account details, or from Discuss, which closes
 * itself and lands here on the Social tab. On your own page, Edit opens account details, the one place
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
    const scroll = useScreenScroll<FlatList<ProfileRow>>();
    const navigation = useNavigation();
    const router = useRouter();
    const { account } = useAccount();
    const { profile, posts, userPostsLoading, userPostsErr } =
        useUserPosts(userId);
    const [tab, setTab] = useState<ProfileTab>("posts");
    const { replies, userRepliesLoading, userRepliesErr } = useUserReplies(
        tab === "replies" ? userId : undefined,
    );
    const [openPostId, setOpenPostId] = useState<number | null>(null);
    const { post: openedPost } = usePost(openPostId);
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

    const renderItem = useCallback<ListRenderItem<ProfileRow>>(
        ({ item }) =>
            item.kind === "post" ? (
                <PostCard post={item.post} />
            ) : (
                <ReplyCard reply={item.reply} onPress={setOpenPostId} />
            ),
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

    const blocked = profile?.blocked === true;
    const rows = useMemo((): ProfileRow[] => {
        if (blocked) return [];
        return tab === "posts"
            ? posts.map((post) => ({ kind: "post", post }))
            : replies.map((reply) => ({ kind: "reply", reply }));
    }, [blocked, posts, replies, tab]);
    const [loading, failed, noun] =
        tab === "posts"
            ? [userPostsLoading && posts.length === 0, userPostsErr, "posts"]
            : [
                  userRepliesLoading && replies.length === 0,
                  userRepliesErr,
                  "replies",
              ];
    const emptyLabel = blocked
        ? "You blocked this account."
        : loading
          ? `Loading ${noun}...`
          : failed
            ? `Couldn't load ${noun}.`
            : `No ${noun} yet.`;
    const openPost =
        openedPost && openedPost.post_id === openPostId ? openedPost : null;

    return (
        <View className="flex-1 bg-background">
            <ScreenScrollMarker>
                <Animated.FlatList
                    {...scroll}
                    className="flex-1"
                    data={rows}
                    keyboardShouldPersistTaps="handled"
                    keyExtractor={rowKey}
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
                                blocked={blocked}
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
                            <View className="mb-6 gap-6">
                                <ProfileListening userId={userId} />
                                {blocked ? null : (
                                    <ProfileShelves userId={userId} />
                                )}
                            </View>
                            {blocked ? null : (
                                <View className="mb-4">
                                    <SegmentedControl
                                        size="sm"
                                        options={PROFILE_TABS}
                                        value={tab}
                                        onChange={setTab}
                                    />
                                </View>
                            )}
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
            {openPost ? (
                <PostCommentsDialog
                    open
                    onOpenChange={(open) => {
                        if (!open) setOpenPostId(null);
                    }}
                    post={openPost}
                    onAuthorPress={(authorId) => {
                        setOpenPostId(null);
                        router.push(`/social/user/${authorId}`);
                    }}
                />
            ) : null}
            <Toast toast={toast} />
        </View>
    );
}

function rowKey(row: ProfileRow) {
    return row.kind === "post"
        ? `post:${row.post.post_id}`
        : `reply:${row.reply.comment_id}`;
}

/** One reply: who and what it answered, then the reply itself. */
function ReplyCard({
    reply,
    onPress,
}: {
    reply: SocialReply;
    onPress: (postId: number) => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Reply to ${reply.post.author.username}: ${reply.content}`}
            onPress={() => onPress(reply.post_id)}
            className="gap-2 rounded-2xl border border-border p-4 active:opacity-60"
        >
            <Text className="text-xs text-muted-foreground">
                Replying to {reply.post.author.username}
                {" \u00b7 "}
                {formatRelativeTime(reply.created_at)}
            </Text>
            <Text
                className="border-l-2 border-border pl-3 text-sm text-muted-foreground"
                numberOfLines={2}
            >
                {reply.post.content}
            </Text>
            <Text className="text-base text-foreground">{reply.content}</Text>
        </Pressable>
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

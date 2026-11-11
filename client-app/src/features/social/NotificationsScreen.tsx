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
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    View,
    type ListRenderItem,
    type ViewToken,
} from "react-native";
import Animated from "react-native-reanimated";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAnswerJoinRequest } from "@/lib/routes/live-sessions";
import {
    useAcceptFriendRequest,
    useCancelFriendRequest,
    useMarkNotificationsRead,
    useNotifications,
    usePost,
} from "@/lib/routes/social";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { useAppTheme } from "@/lib/theme";
import type { NotificationType, SocialNotification } from "@/lib/types";

import { formatRelativeTime } from "./format";
import { PostCommentsDialog } from "./PostCommentsDialog";

type FriendRequestState = "open" | "accepted" | "ignored";

const NOTIFICATION_ICON = {
    comment: "chatbubble",
    friend_req_received: "person-add",
    friend_req_accepted: "person-add",
    session_join_request: "radio",
    session_join_accepted: "radio",
} as const satisfies Record<
    NotificationType,
    "chatbubble" | "person-add" | "radio"
>;

/**
 * Buttons while a received friend or session join request is unanswered,
 * then the choice.
 */
function friendRequestState(
    item: SocialNotification,
): FriendRequestState | null {
    if (
        item.type !== "friend_req_received" &&
        item.type !== "session_join_request"
    )
        return null;
    const resolution = item.metadata.resolution;
    if (resolution === "accepted" || resolution === "ignored")
        return resolution;
    return item.metadata.sender_id ? "open" : null;
}

/** The signed-in user's notifications, unread above the line. */
export function NotificationsScreen() {
    const navigation = useNavigation();
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll<FlatList<NoticeRow>>();
    const { colors } = useTheme();
    const {
        notifications,
        notificationsLoading,
        notificationsErr,
        hasNextPage,
        isLoadingNextPage,
        loadNextPage,
        setNotificationResolution,
    } = useNotifications();
    const { markNotificationsRead } = useMarkNotificationsRead();
    const markReadRef = useRef(markNotificationsRead);
    markReadRef.current = markNotificationsRead;
    const markedReadIds = useRef(new Set<number>());
    const { acceptFriendRequest, acceptFriendRequestLoading } =
        useAcceptFriendRequest();
    const { cancelFriendRequest, cancelFriendRequestLoading } =
        useCancelFriendRequest();
    const { answerJoinRequest, answerJoinRequestLoading } =
        useAnswerJoinRequest();
    const requestBusy =
        acceptFriendRequestLoading ||
        cancelFriendRequestLoading ||
        answerJoinRequestLoading;
    const router = useRouter();
    const [openPostId, setOpenPostId] = useState<number | null>(null);
    const { post, postLoading, postErr } = usePost(openPostId);
    const reportedPostErr = useRef<number | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const showToast = useCallback((message: string) => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast(message);
        toastTimer.current = setTimeout(() => setToast(null), 3000);
    }, []);

    useLayoutEffect(() => {
        return () => {
            if (toastTimer.current) clearTimeout(toastTimer.current);
        };
    }, []);

    useEffect(() => {
        if (openPostId == null || postLoading || !postErr) return;
        if (reportedPostErr.current === openPostId) return;
        reportedPostErr.current = openPostId;
        showToast("Couldn't open that post.");
        setOpenPostId(null);
    }, [openPostId, postErr, postLoading, showToast]);

    const answerRequest = useCallback(
        async (
            item: SocialNotification,
            resolution: "accepted" | "ignored",
        ) => {
            const senderId = item.metadata.sender_id;
            if (!senderId || requestBusy) return;
            const sessionId = item.metadata.session_id;
            if (item.type === "session_join_request" && sessionId) {
                try {
                    await answerJoinRequest({
                        session_id: sessionId,
                        user_id: senderId,
                        accept: resolution === "accepted",
                    });
                    showToast(
                        resolution === "accepted"
                            ? `Let ${item.title} in`
                            : `Didn't let ${item.title} in`,
                    );
                    await setNotificationResolution(item.notif_id, resolution);
                } catch {
                    showToast("Couldn't answer. The session may be over.");
                }
                return;
            }
            try {
                if (resolution === "accepted") {
                    await acceptFriendRequest({ user_id: senderId });
                    showToast(`Accepted ${item.title}'s friend request`);
                } else {
                    await cancelFriendRequest({ user_id: senderId });
                    showToast(`Ignored ${item.title}'s friend request`);
                }
                await setNotificationResolution(item.notif_id, resolution);
            } catch {
                // Leave the buttons. The friends page only toasts after success.
            }
        },
        [
            acceptFriendRequest,
            answerJoinRequest,
            cancelFriendRequest,
            requestBusy,
            setNotificationResolution,
            showToast,
        ],
    );

    useLayoutEffect(() => {
        navigation.setOptions({ title: "Notifications" });
    }, [navigation]);

    const rows = useMemo((): NoticeRow[] => {
        if (notifications.length === 0 && notificationsLoading) {
            return [{ kind: "status", label: "Loading..." }];
        }
        if (notifications.length === 0 && notificationsErr) {
            return [{ kind: "status", label: "Couldn't load notifications." }];
        }
        const unread = notifications.filter((item) => item.unread);
        const read = notifications.filter((item) => !item.unread);
        const next: NoticeRow[] = [];
        if (unread.length > 0) {
            for (const item of unread)
                next.push({ kind: "notification", item });
            next.push({ kind: "separator", label: "--- unread above ---" });
        } else {
            next.push({ kind: "separator", label: "--- no new notifs ---" });
        }
        for (const item of read) next.push({ kind: "notification", item });
        return next;
    }, [notifications, notificationsErr, notificationsLoading]);

    const onEndReached = useCallback(() => {
        if (hasNextPage && !isLoadingNextPage) void loadNextPage();
    }, [hasNextPage, isLoadingNextPage, loadNextPage]);

    const onViewableItemsChanged = useRef(
        ({ viewableItems }: { viewableItems: ViewToken[] }) => {
            const ids: number[] = [];
            for (const token of viewableItems) {
                const row = token.item as NoticeRow | undefined;
                if (!token.isViewable || row?.kind !== "notification") continue;
                if (!row.item.unread) continue;
                const id = row.item.notif_id;
                if (markedReadIds.current.has(id)) continue;
                markedReadIds.current.add(id);
                ids.push(id);
            }
            if (ids.length === 0) return;
            void markReadRef.current(ids).catch(() => {
                for (const id of ids) markedReadIds.current.delete(id);
            });
        },
    ).current;

    const renderItem = useCallback<ListRenderItem<NoticeRow>>(
        ({ item }) => {
            if (item.kind === "notification") {
                return (
                    <NotificationRow
                        item={item.item}
                        requestBusy={requestBusy}
                        onAnswer={answerRequest}
                        onOpenPost={setOpenPostId}
                    />
                );
            }
            if (item.kind === "status") {
                return (
                    <Text className="py-2 text-sm text-muted-foreground">
                        {item.label}
                    </Text>
                );
            }
            return <NoticeSeparator label={item.label} />;
        },
        [answerRequest, requestBusy],
    );

    const openPost =
        post && openPostId != null && post.post_id === openPostId ? post : null;

    return (
        <View className="flex-1 bg-background">
            <ScreenScrollMarker>
                <Animated.FlatList
                    {...scroll}
                    className="flex-1"
                    data={rows}
                    keyExtractor={keyExtractor}
                    renderItem={renderItem}
                    onViewableItemsChanged={onViewableItemsChanged}
                    onEndReached={onEndReached}
                    onEndReachedThreshold={1}
                    contentContainerStyle={[
                        {
                            paddingHorizontal: 20,
                            paddingBottom: listBottomInset + 48,
                        },
                        scroll.contentContainerStyle,
                    ]}
                    ListFooterComponent={
                        isLoadingNextPage ? (
                            <View className="items-center py-4">
                                <ActivityIndicator color={colors.text} />
                            </View>
                        ) : null
                    }
                    showsVerticalScrollIndicator={false}
                />
            </ScreenScrollMarker>
            {toast ? (
                <View
                    pointerEvents="none"
                    accessibilityRole="alert"
                    className="absolute left-5 right-5 top-3 rounded-2xl bg-foreground px-4 py-3"
                >
                    <Text className="text-center text-sm text-background">
                        {toast}
                    </Text>
                </View>
            ) : null}
            {openPost ? (
                <PostCommentsDialog
                    open
                    onOpenChange={(open) => {
                        if (!open) setOpenPostId(null);
                    }}
                    post={openPost}
                    onAuthorPress={(userId) => {
                        router.push(`/social/user/${userId}`);
                    }}
                />
            ) : null}
        </View>
    );
}

type NoticeRow =
    | { kind: "status"; label: string }
    | { kind: "separator"; label: string }
    | { kind: "notification"; item: SocialNotification };

function keyExtractor(row: NoticeRow) {
    if (row.kind === "notification") return String(row.item.notif_id);
    return `${row.kind}:${row.label}`;
}

function NotificationRow({
    item,
    requestBusy,
    onAnswer,
    onOpenPost,
}: {
    item: SocialNotification;
    requestBusy: boolean;
    onAnswer: (
        item: SocialNotification,
        resolution: "accepted" | "ignored",
    ) => void;
    onOpenPost: (postId: number) => void;
}) {
    const { foreground, brand, primaryForeground } = useAppTheme().colors;
    const icon = NOTIFICATION_ICON[item.type];
    const iconColor = icon === "person-add" ? foreground : brand;

    const request = friendRequestState(item);
    const postId = item.type === "comment" ? item.metadata.post_id : undefined;

    const row = (
        <View className="flex-row items-start gap-3 py-3">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
                <Ionicons name={icon} size={18} color={iconColor} />
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-base text-foreground" numberOfLines={2}>
                    {item.title}
                </Text>
                <Text
                    className="text-sm text-muted-foreground"
                    numberOfLines={2}
                >
                    {item.content}
                </Text>
                {request === "open" ? (
                    <View className="flex-row items-center gap-2 pt-1">
                        <Button
                            accessibilityLabel={
                                item.type === "session_join_request"
                                    ? `Don't let ${item.title} in`
                                    : `Ignore ${item.title}`
                            }
                            className="w-9 px-0"
                            size="sm"
                            variant="outline"
                            disabled={requestBusy}
                            onPress={() => void onAnswer(item, "ignored")}
                        >
                            <Ionicons
                                name="close"
                                size={18}
                                color={foreground}
                            />
                        </Button>
                        <Button
                            accessibilityLabel={
                                item.type === "session_join_request"
                                    ? `Let ${item.title} in`
                                    : `Accept ${item.title}`
                            }
                            className="w-9 px-0"
                            size="sm"
                            disabled={requestBusy}
                            onPress={() => void onAnswer(item, "accepted")}
                        >
                            <Ionicons
                                name="checkmark"
                                size={18}
                                color={primaryForeground}
                            />
                        </Button>
                    </View>
                ) : request ? (
                    <Text className="pt-1 text-sm text-muted-foreground">
                        (
                        {item.type === "session_join_request"
                            ? request === "accepted"
                                ? "let in"
                                : "not now"
                            : request}
                        )
                    </Text>
                ) : null}
            </View>
            <Text className="pt-1 text-xs text-muted-foreground">
                {formatRelativeTime(item.created_at)}
            </Text>
        </View>
    );

    if (postId == null) return row;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={() => onOpenPost(postId)}
            className="active:opacity-60"
        >
            {row}
        </Pressable>
    );
}

function NoticeSeparator({ label }: { label: string }) {
    return (
        <Text className="py-2 text-center text-sm text-muted-foreground">
            {label}
        </Text>
    );
}

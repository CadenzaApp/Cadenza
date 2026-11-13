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

import { ListDivider } from "@/components/custom/list-divider";
import { SwipeToDelete } from "@/components/custom/swipe-to-delete";
import { Button } from "@/components/ui/button";
import { GlassConfirmDialog } from "@/components/ui/glass-confirm-dialog";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
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
import {
    describeGroup,
    groupNotifications,
    type NotificationGroup,
} from "./notification-groups";
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

/** The list's side padding. Swipe rows run past it to the screen's edge. */
const LIST_PADDING = 20;

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

/**
 * The signed-in user's notifications, unread above the line. A run of the
 * same type folds into one row that opens to show each. Swipe a row or a
 * group left to dismiss it; the header clears them all.
 */
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
        dismissNotifications,
    } = useNotifications();
    const [expandedGroups, setExpandedGroups] = useState<Set<number>>(
        () => new Set(),
    );
    const [confirmClear, setConfirmClear] = useState(false);
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

    const dismiss = useCallback(
        async (ids?: number[]) => {
            try {
                await dismissNotifications(ids);
            } catch {
                showToast("Couldn't dismiss. Try again.");
            }
        },
        [dismissNotifications, showToast],
    );

    const toggleGroup = useCallback((key: number) => {
        setExpandedGroups((current) => {
            const next = new Set(current);
            if (!next.delete(key)) next.add(key);
            return next;
        });
    }, []);

    const hasNotifications = notifications.length > 0;
    useLayoutEffect(() => {
        navigation.setOptions({
            title: "Notifications",
            headerRight: hasNotifications
                ? () => (
                      <GlassIconButton
                          accessibilityLabel="Clear all notifications"
                          onPress={() => setConfirmClear(true)}
                      >
                          <Ionicons
                              name="trash-outline"
                              size={20}
                              color={colors.text}
                          />
                      </GlassIconButton>
                  )
                : undefined,
        });
    }, [colors.text, hasNotifications, navigation]);

    const rows = useMemo((): NoticeRow[] => {
        if (notifications.length === 0 && notificationsLoading) {
            return [{ kind: "status", label: "Loading..." }];
        }
        if (notifications.length === 0 && notificationsErr) {
            return [{ kind: "status", label: "Couldn't load notifications." }];
        }
        if (notifications.length === 0) {
            return [{ kind: "status", label: "No notifications yet." }];
        }
        const unread = notifications.filter((item) => item.unread);
        const read = notifications.filter((item) => !item.unread);
        const next: NoticeRow[] = [];
        const pushGroups = (items: SocialNotification[]) => {
            for (const group of groupNotifications(items)) {
                const [first] = group.items;
                if (group.items.length === 1) {
                    next.push({
                        kind: "notification",
                        item: first!,
                        nested: false,
                    });
                    continue;
                }
                const expanded = expandedGroups.has(first!.notif_id);
                next.push({ kind: "group", group, expanded });
                if (!expanded) continue;
                for (const item of group.items)
                    next.push({ kind: "notification", item, nested: true });
            }
        };
        pushGroups(unread);
        if (read.length > 0) {
            next.push({
                kind: "divider",
                label: unread.length > 0 ? "Earlier" : "No new notifications",
            });
        }
        pushGroups(read);
        return next;
    }, [expandedGroups, notifications, notificationsErr, notificationsLoading]);

    const onEndReached = useCallback(() => {
        if (hasNextPage && !isLoadingNextPage) void loadNextPage();
    }, [hasNextPage, isLoadingNextPage, loadNextPage]);

    const onViewableItemsChanged = useRef(
        ({ viewableItems }: { viewableItems: ViewToken[] }) => {
            const ids: number[] = [];
            for (const token of viewableItems) {
                const row = token.item as NoticeRow | undefined;
                if (!token.isViewable || !row) continue;
                // a folded group counts as seen with its row
                const items =
                    row.kind === "notification"
                        ? [row.item]
                        : row.kind === "group"
                          ? row.group.items
                          : [];
                for (const item of items) {
                    const id = item.notif_id;
                    if (!item.unread || markedReadIds.current.has(id)) continue;
                    markedReadIds.current.add(id);
                    ids.push(id);
                }
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
                const notice = item.item;
                return (
                    <SwipeToDelete
                        accessibilityLabel="Dismiss"
                        bleed={LIST_PADDING}
                        onDelete={() => void dismiss([notice.notif_id])}
                    >
                        <View
                            className="bg-background"
                            style={{
                                paddingHorizontal: LIST_PADDING,
                                // nested under its group
                                paddingLeft:
                                    LIST_PADDING + (item.nested ? 24 : 0),
                            }}
                        >
                            <NotificationRow
                                item={notice}
                                requestBusy={requestBusy}
                                onAnswer={answerRequest}
                                onOpenPost={setOpenPostId}
                            />
                        </View>
                    </SwipeToDelete>
                );
            }
            if (item.kind === "group") {
                const { group } = item;
                return (
                    <SwipeToDelete
                        accessibilityLabel="Dismiss"
                        bleed={LIST_PADDING}
                        onDelete={() =>
                            void dismiss(group.items.map((n) => n.notif_id))
                        }
                    >
                        <View
                            className="bg-background"
                            style={{ paddingHorizontal: LIST_PADDING }}
                        >
                            <GroupRow
                                group={group}
                                expanded={item.expanded}
                                onToggle={toggleGroup}
                            />
                        </View>
                    </SwipeToDelete>
                );
            }
            if (item.kind === "status") {
                return (
                    <Text className="py-2 text-sm text-muted-foreground">
                        {item.label}
                    </Text>
                );
            }
            return <ListDivider label={item.label} />;
        },
        [answerRequest, dismiss, requestBusy, toggleGroup],
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
                            paddingHorizontal: LIST_PADDING,
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
            <GlassConfirmDialog
                open={confirmClear}
                title="Clear all notifications?"
                description="This deletes every notification. Requests you have not answered can still be answered from the friends page or the session."
                confirmLabel="Clear all"
                pendingLabel="Clearing..."
                onOpenChange={setConfirmClear}
                onConfirm={() => {
                    setConfirmClear(false);
                    void dismiss();
                }}
            />
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
    | { kind: "divider"; label: string }
    | { kind: "group"; group: NotificationGroup; expanded: boolean }
    | { kind: "notification"; item: SocialNotification; nested: boolean };

function keyExtractor(row: NoticeRow) {
    if (row.kind === "notification") return String(row.item.notif_id);
    if (row.kind === "group") return `group:${row.group.items[0]!.notif_id}`;
    return row.kind;
}

/** A folded run of one type: who, what, how many. Tap to open or close. */
function GroupRow({
    group,
    expanded,
    onToggle,
}: {
    group: NotificationGroup;
    expanded: boolean;
    onToggle: (key: number) => void;
}) {
    const { foreground, brand, mutedForeground } = useAppTheme().colors;
    const icon = NOTIFICATION_ICON[group.type];
    const { names, action } = describeGroup(group);
    const first = group.items[0]!;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={`${names} ${action}, ${group.items.length} notifications`}
            onPress={() => onToggle(first.notif_id)}
            className="flex-row items-center gap-3 py-3 active:opacity-60"
        >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
                <Ionicons
                    name={icon}
                    size={18}
                    color={icon === "person-add" ? foreground : brand}
                />
                <View className="absolute -right-1 -top-1 min-w-5 items-center rounded-full bg-brand px-1">
                    <Text className="text-xs font-semibold text-primary-foreground">
                        {group.items.length}
                    </Text>
                </View>
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-base text-foreground" numberOfLines={2}>
                    {names}
                </Text>
                <Text className="text-sm text-muted-foreground">{action}</Text>
            </View>
            <Text className="text-xs text-muted-foreground">
                {formatRelativeTime(first.created_at)}
            </Text>
            <Ionicons
                name={expanded ? "chevron-up" : "chevron-down"}
                size={16}
                color={mutedForeground}
            />
        </Pressable>
    );
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

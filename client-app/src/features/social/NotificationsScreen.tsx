import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useCallback, useLayoutEffect, useMemo } from "react";
import {
    ActivityIndicator,
    FlatList,
    View,
    type ListRenderItem,
} from "react-native";
import Animated from "react-native-reanimated";

import { Text } from "@/components/ui/text";
import { useNotifications } from "@/lib/routes/social";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { useAppTheme } from "@/lib/theme";
import type { NotificationIcon, SocialNotification } from "@/lib/types";

import { formatRelativeTime } from "./format";

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
    } = useNotifications();

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

    const renderItem = useCallback<ListRenderItem<NoticeRow>>(({ item }) => {
        if (item.kind === "notification") {
            return <NotificationRow item={item.item} />;
        }
        if (item.kind === "status") {
            return (
                <Text className="py-2 text-sm text-muted-foreground">
                    {item.label}
                </Text>
            );
        }
        return <NoticeSeparator label={item.label} />;
    }, []);

    return (
        <View className="flex-1 bg-background">
            <ScreenScrollMarker>
                <Animated.FlatList
                    {...scroll}
                    className="flex-1"
                    data={rows}
                    keyExtractor={keyExtractor}
                    renderItem={renderItem}
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

function NotificationRow({ item }: { item: SocialNotification }) {
    const { foreground, like, brand } = useAppTheme().colors;
    const iconColor = {
        heart: like,
        chatbubble: brand,
        "person-add": foreground,
    } satisfies Record<NotificationIcon, string>;

    return (
        <View className="flex-row items-center gap-3 py-3">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
                <Ionicons
                    name={item.icon}
                    size={18}
                    color={iconColor[item.icon]}
                />
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-base text-foreground" numberOfLines={1}>
                    {item.title}
                </Text>
                <Text
                    className="text-sm text-muted-foreground"
                    numberOfLines={2}
                >
                    {item.content}
                </Text>
            </View>
            <Text className="text-xs text-muted-foreground">
                {formatRelativeTime(item.created_at)}
            </Text>
        </View>
    );
}

function NoticeSeparator({ label }: { label: string }) {
    return (
        <Text className="py-2 text-center text-sm text-muted-foreground">
            {label}
        </Text>
    );
}

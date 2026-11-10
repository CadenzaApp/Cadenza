import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation } from "expo-router";
import { useLayoutEffect } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";

import { Text } from "@/components/ui/text";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { useAppTheme } from "@/lib/theme";

import { formatRelativeTime } from "./format";

type NotificationKind = "like" | "comment" | "friend";

type DummyNotification = {
    id: string;
    username: string;
    kind: NotificationKind;
    body: string;
    createdAt: string;
    unread: boolean;
};

const MINUTE_MS = 60_000;

function minutesAgo(minutes: number): string {
    return new Date(Date.now() - minutes * MINUTE_MS).toISOString();
}

/** Stand-in rows until notifications come from the API. */
const DUMMY_NOTIFICATIONS: DummyNotification[] = [
    {
        id: "like-miles",
        username: "miles.davis",
        kind: "like",
        body: "liked your post",
        createdAt: minutesAgo(12),
        unread: true,
    },
    {
        id: "comment-nina",
        username: "nina.simone",
        kind: "comment",
        body: 'commented: "this one stays on repeat"',
        createdAt: minutesAgo(3 * 60),
        unread: true,
    },
    {
        id: "friend-ada",
        username: "ada.lovelace",
        kind: "friend",
        body: "sent you a friend request",
        createdAt: minutesAgo(26 * 60),
        unread: false,
    },
    {
        id: "like-coltrane",
        username: "john.coltrane",
        kind: "like",
        body: "liked your post about Kind of Blue",
        createdAt: minutesAgo(4 * 24 * 60),
        unread: false,
    },
];

const KIND_ICON = {
    like: "heart",
    comment: "chatbubble",
    friend: "person-add",
} as const satisfies Record<NotificationKind, keyof typeof Ionicons.glyphMap>;

/** A few dummy notifications, newest first. */
export function NotificationsScreen() {
    const navigation = useNavigation();
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll();

    useLayoutEffect(() => {
        navigation.setOptions({ title: "Notifications" });
    }, [navigation]);

    const unread = DUMMY_NOTIFICATIONS.filter((item) => item.unread);
    const read = DUMMY_NOTIFICATIONS.filter((item) => !item.unread);

    return (
        <View className="flex-1 bg-background">
            <ScreenScrollMarker>
                <Animated.ScrollView
                    {...scroll}
                    className="flex-1"
                    contentContainerStyle={[
                        {
                            paddingHorizontal: 20,
                            paddingBottom: listBottomInset + 48,
                        },
                        scroll.contentContainerStyle,
                    ]}
                    showsVerticalScrollIndicator={false}
                >
                    {unread.length > 0 ? (
                        <>
                            {unread.map((item) => (
                                <NotificationRow key={item.id} item={item} />
                            ))}
                            <NoticeSeparator label="--- unread above ---" />
                        </>
                    ) : (
                        <NoticeSeparator label="--- no new notifs ---" />
                    )}
                    {read.map((item) => (
                        <NotificationRow key={item.id} item={item} />
                    ))}
                </Animated.ScrollView>
            </ScreenScrollMarker>
        </View>
    );
}

function NotificationRow({ item }: { item: DummyNotification }) {
    const { foreground, like, brand } = useAppTheme().colors;
    const iconColor = { like, comment: brand, friend: foreground }[item.kind];

    return (
        <View className="flex-row items-center gap-3 py-3">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
                <Ionicons
                    name={KIND_ICON[item.kind]}
                    size={18}
                    color={iconColor}
                />
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-base text-foreground" numberOfLines={1}>
                    {item.username}
                </Text>
                <Text
                    className="text-sm text-muted-foreground"
                    numberOfLines={2}
                >
                    {item.body}
                </Text>
            </View>
            <Text className="text-xs text-muted-foreground">
                {formatRelativeTime(item.createdAt)}
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

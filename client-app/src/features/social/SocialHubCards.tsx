import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter, type Href } from "expo-router";
import type { GestureResponderEvent } from "react-native";
import { Pressable, View } from "react-native";

import { GlassPanel } from "@/components/ui/glass-panel";
import type { IoniconName } from "@/components/ui/ionicon-name";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useFriendsListening } from "@/lib/routes/listening";
import { useProfile } from "@/lib/routes/profile";
import { useFriendshipsWithPresence } from "@/lib/routes/social";
import { useAppTheme } from "@/lib/theme";

import { Initials } from "./MemberRow";
import { isFriendOnline, onlineFirst } from "./presence";

/** Friends shown in the avatar stack before "+N". */
const STACK_SIZE = 3;

/**
 * The two cards at the top of the Social tab: Me (profile, shared playlists,
 * privacy) and Friends (who is online, and requests waiting). A friend is
 * online with the app open or while playing something, and online friends
 * lead the avatar stack.
 */
export function SocialHubCards() {
    return (
        <View className="mb-6 flex-row gap-3">
            <MeCard />
            <FriendsCard />
        </View>
    );
}

function MeCard() {
    const router = useRouter();
    const { account } = useAccount();
    const { profile, profileLoading } = useProfile();
    const { mutedForeground } = useAppTheme().colors;
    const openProfile = () => {
        if (account?.id) router.push(`/social/user/${account.id}`);
    };

    return (
        <GlassPanel className="flex-1">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Your profile"
                onPress={openProfile}
                className="gap-3 p-4 active:opacity-60"
                style={{ minHeight: 132 }}
            >
                <View className="flex-row items-center gap-2">
                    {profileLoading ? (
                        <Skeleton className="h-8 w-8 rounded-full" />
                    ) : (
                        <Initials
                            username={
                                profile?.username ?? account?.email ?? "?"
                            }
                            size={32}
                        />
                    )}
                    <Text className="flex-1 text-base font-semibold text-foreground">
                        Me
                    </Text>
                    <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={mutedForeground}
                    />
                </View>
                <View className="flex-row justify-between">
                    <Shortcut
                        icon="person-circle-outline"
                        label="Profile"
                        accessibilityLabel="Your profile"
                        onPress={openProfile}
                    />
                    <Shortcut
                        icon="albums-outline"
                        label="Playlists"
                        accessibilityLabel="Shared playlists"
                        onPress={() => router.push("/social/playlists" as Href)}
                    />
                    <Shortcut
                        icon="lock-closed-outline"
                        label="Privacy"
                        accessibilityLabel="Privacy settings"
                        onPress={() => router.push("/privacy" as Href)}
                    />
                </View>
            </Pressable>
        </GlassPanel>
    );
}

function Shortcut({
    icon,
    label,
    accessibilityLabel,
    onPress,
}: {
    icon: IoniconName;
    label: string;
    accessibilityLabel: string;
    onPress: () => void;
}) {
    const { foreground } = useAppTheme().colors;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            onPress={(event: GestureResponderEvent) => {
                event.stopPropagation();
                onPress();
            }}
            className="w-12 items-center gap-1 active:opacity-60"
        >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-muted/60">
                <Ionicons name={icon} size={20} color={foreground} />
            </View>
            <Text className="text-[11px] text-muted-foreground">{label}</Text>
        </Pressable>
    );
}

function FriendsCard() {
    const router = useRouter();
    const { friends, incoming, friendshipsLoading, friendshipsErr } =
        useFriendshipsWithPresence();
    const { friendsListening } = useFriendsListening();
    const { mutedForeground } = useAppTheme().colors;

    const listeningIds = new Set(
        (friendsListening ?? []).map((friend) => friend.user_id),
    );
    const ordered = onlineFirst(friends, listeningIds);
    const shown = ordered.slice(0, STACK_SIZE);
    const more = ordered.length - shown.length;
    const online = ordered.filter((friend) =>
        isFriendOnline(friend, listeningIds),
    ).length;

    const status = friendshipsErr
        ? "Couldn't load"
        : friends.length === 0 && !friendshipsLoading
          ? "Find people"
          : online > 0
            ? `${online} online`
            : `${friends.length} friends`;
    const label = [
        "Friends",
        online > 0 ? `${online} online` : null,
        incoming.length > 0
            ? `${incoming.length} request${incoming.length === 1 ? "" : "s"}`
            : null,
    ]
        .filter(Boolean)
        .join(", ");

    return (
        <GlassPanel className="flex-1">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={() => router.push("/social/friends")}
                className="gap-2 p-4 active:opacity-60"
                style={{ minHeight: 132 }}
            >
                <View className="flex-row items-center">
                    <Text className="flex-1 text-base font-semibold text-foreground">
                        Friends
                    </Text>
                    <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={mutedForeground}
                    />
                </View>
                <View className="flex-row items-center gap-1.5">
                    {online > 0 ? (
                        <View className="h-2 w-2 rounded-full bg-success" />
                    ) : null}
                    <Text className="text-sm text-muted-foreground">
                        {status}
                    </Text>
                </View>
                {friendshipsLoading ? (
                    <View className="flex-row">
                        {[0, 1, 2].map((i) => (
                            <Skeleton
                                key={i}
                                className={`h-8 w-8 rounded-full ${i ? "-ml-2" : ""}`}
                            />
                        ))}
                    </View>
                ) : shown.length > 0 ? (
                    <View
                        className="flex-row"
                        importantForAccessibility="no-hide-descendants"
                    >
                        {shown.map((friend, i) => (
                            <View
                                key={friend.user_id}
                                className={i ? "-ml-2" : ""}
                            >
                                <Initials
                                    username={friend.username}
                                    size={32}
                                    online={isFriendOnline(
                                        friend,
                                        listeningIds,
                                    )}
                                />
                            </View>
                        ))}
                        {more > 0 ? (
                            <View className="-ml-2 h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-muted">
                                <Text className="text-xs font-semibold text-foreground">
                                    +{more}
                                </Text>
                            </View>
                        ) : null}
                    </View>
                ) : null}
                {incoming.length > 0 ? (
                    <Text className="text-xs font-semibold text-brand">
                        {incoming.length} request
                        {incoming.length === 1 ? "" : "s"}
                    </Text>
                ) : null}
            </Pressable>
        </GlassPanel>
    );
}

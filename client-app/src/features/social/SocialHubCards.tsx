import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { GlassPanel } from "@/components/ui/glass-panel";
import type { IoniconName } from "@/components/ui/ionicon-name";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useFriendsListening } from "@/lib/routes/listening";
import { useProfile } from "@/lib/routes/profile";
import { useFriendshipsWithPresence } from "@/lib/routes/social";
import { useAppTheme } from "@/lib/theme";

import { isFriendOnline } from "./presence";

/**
 * The two cards at the top of the Social tab: My profile, and Friends with
 * who is online and requests waiting. A friend is online with the app open
 * or while playing something.
 */
export function SocialHubCards() {
    return (
        <View className="mb-6 flex-row gap-3">
            <ProfileCard />
            <FriendsCard />
        </View>
    );
}

function ProfileCard() {
    const router = useRouter();
    const { account } = useAccount();
    const { profile } = useProfile();
    return (
        <HubCard
            icon="person-outline"
            title="My profile"
            accessibilityLabel="Your profile"
            onPress={() => {
                if (account?.id) router.push(`/social/user/${account.id}`);
            }}
        >
            {profile?.username ? (
                <Text
                    className="text-xs text-muted-foreground"
                    numberOfLines={1}
                >
                    @{profile.username}
                </Text>
            ) : null}
        </HubCard>
    );
}

function FriendsCard() {
    const router = useRouter();
    const { friends, incoming, friendshipsLoading, friendshipsErr } =
        useFriendshipsWithPresence();
    const { friendsListening } = useFriendsListening();

    const listeningIds = new Set(
        (friendsListening ?? []).map((friend) => friend.user_id),
    );
    const online = friends.filter((friend) =>
        isFriendOnline(friend, listeningIds),
    ).length;
    const requests = incoming.length;
    const requestsLabel = `${requests} request${requests === 1 ? "" : "s"}`;

    const status = friendshipsErr
        ? "Couldn't load"
        : requests > 0
          ? requestsLabel
          : online > 0
            ? `${online} online`
            : friends.length === 0 && !friendshipsLoading
              ? "Find people"
              : `${friends.length} friends`;
    const label = [
        "Friends",
        online > 0 ? `${online} online` : null,
        requests > 0 ? requestsLabel : null,
    ]
        .filter(Boolean)
        .join(", ");

    return (
        <HubCard
            icon="people-outline"
            title="Friends"
            accessibilityLabel={label}
            onPress={() => router.push("/social/friends")}
        >
            {friendshipsLoading && friends.length === 0 ? null : (
                <View className="flex-row items-center gap-1.5">
                    {requests === 0 && online > 0 ? (
                        <View className="h-2 w-2 rounded-full bg-success" />
                    ) : null}
                    <Text
                        className={
                            requests > 0
                                ? "text-xs font-semibold text-brand"
                                : "text-xs text-muted-foreground"
                        }
                        numberOfLines={1}
                    >
                        {status}
                    </Text>
                </View>
            )}
        </HubCard>
    );
}

/** An icon, a title with a line under it, and a chevron. */
function HubCard({
    icon,
    title,
    accessibilityLabel,
    onPress,
    children,
}: {
    icon: IoniconName;
    title: string;
    accessibilityLabel: string;
    onPress: () => void;
    children?: ReactNode;
}) {
    const { foreground, mutedForeground } = useAppTheme().colors;
    return (
        <GlassPanel className="flex-1">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                onPress={onPress}
                className="flex-row items-center gap-3 px-4 py-3 active:opacity-60"
                style={{ minHeight: 60 }}
            >
                <Ionicons name={icon} size={22} color={foreground} />
                <View className="min-w-0 flex-1">
                    <Text
                        className="text-base font-semibold text-foreground"
                        numberOfLines={1}
                    >
                        {title}
                    </Text>
                    {children}
                </View>
                <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={mutedForeground}
                />
            </Pressable>
        </GlassPanel>
    );
}

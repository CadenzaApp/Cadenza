import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation, useRouter } from "expo-router";
import { useLayoutEffect, useState, type ReactNode } from "react";
import {
    Image,
    Pressable,
    ScrollView,
    useWindowDimensions,
    View,
} from "react-native";
import Animated from "react-native-reanimated";

import { ErrorNotice } from "@/components/custom/error-notice";
import { Toast, useToast } from "@/components/custom/toast";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useFriendsListening } from "@/lib/routes/listening";
import {
    useAcceptFriendRequest,
    useBlockUser,
    useCancelFriendRequest,
    useFavoriteFriend,
    useFriendshipsWithPresence,
    useUserSearch,
} from "@/lib/routes/social";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { useAppTheme } from "@/lib/theme";
import type { SocialPerson } from "@/lib/types";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { isUsableArtworkUrl } from "@/lib/utils";

import { LiveChip } from "./LiveChip";
import { Initials } from "./MemberRow";
import { isFriendOnline } from "./presence";

/** How long typing has to pause before a user search runs. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Search, then requests, then friends listening now, then the rest of your
 * friends, then requests you sent, then accounts you blocked. Friends come
 * favorites first, then online, with a green dot on each one online and a
 * star to favorite.
 */
export function FriendsScreen() {
    const navigation = useNavigation();
    const router = useRouter();
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll();
    const { foreground, primaryForeground, mutedForeground, brand } =
        useAppTheme().colors;
    const {
        incoming,
        outgoing,
        friends,
        blocked,
        friendshipsLoading,
        friendshipsErr,
    } = useFriendshipsWithPresence();
    const { setFavorite, favoriteLoading } = useFavoriteFriend();
    const { setBlocked, blockLoading } = useBlockUser();
    const { friendsListening } = useFriendsListening();
    const listeningById = new Map(
        (friendsListening ?? []).map((friend) => [friend.user_id, friend]),
    );
    const listeningIds = new Set(listeningById.keys());
    const listening = friends.filter((friend) =>
        listeningById.has(friend.user_id),
    );
    const notListening = friends.filter(
        (friend) => !listeningById.has(friend.user_id),
    );
    const { acceptFriendRequest, acceptFriendRequestLoading } =
        useAcceptFriendRequest();
    const { cancelFriendRequest, cancelFriendRequestLoading } =
        useCancelFriendRequest();
    const requestBusy =
        acceptFriendRequestLoading || cancelFriendRequestLoading;
    const { toast, showToast } = useToast();

    useLayoutEffect(() => {
        navigation.setOptions({ title: "Friends" });
    }, [navigation]);

    const nobody =
        friends.length === 0 &&
        incoming.length === 0 &&
        outgoing.length === 0 &&
        blocked.length === 0;

    const openProfile = (userId: string) => {
        router.push(`/social/user/${userId}`);
    };

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
                    <SearchSection onPress={openProfile} />
                    {incoming.length > 0 ? (
                        <PersonSection
                            title="Requests"
                            people={incoming}
                            onPress={openProfile}
                            renderActions={(person) => (
                                <View className="flex-row items-center gap-2">
                                    <Button
                                        accessibilityLabel={`Ignore ${person.username}`}
                                        className="w-9 px-0"
                                        size="sm"
                                        variant="outline"
                                        disabled={requestBusy}
                                        onPress={() =>
                                            void cancelFriendRequest({
                                                user_id: person.user_id,
                                            }).then(() =>
                                                showToast(
                                                    `Ignored ${person.username}'s friend request`,
                                                ),
                                            )
                                        }
                                    >
                                        <Ionicons
                                            name="close"
                                            size={18}
                                            color={foreground}
                                        />
                                    </Button>
                                    <Button
                                        accessibilityLabel={`Accept ${person.username}`}
                                        className="w-9 px-0"
                                        size="sm"
                                        disabled={requestBusy}
                                        onPress={() =>
                                            void acceptFriendRequest({
                                                user_id: person.user_id,
                                            }).then(() =>
                                                showToast(
                                                    `Accepted ${person.username}'s friend request`,
                                                ),
                                            )
                                        }
                                    >
                                        <Ionicons
                                            name="checkmark"
                                            size={18}
                                            color={primaryForeground}
                                        />
                                    </Button>
                                </View>
                            )}
                        />
                    ) : null}
                    {listening.length > 0 ? (
                        <PersonSection
                            title="Listening now"
                            people={listening}
                            online={() => true}
                            subtitle={(person) => {
                                const np = listeningById.get(
                                    person.user_id,
                                )?.now_playing;
                                return np
                                    ? [np.title, np.artist]
                                          .filter(Boolean)
                                          .join(" - ")
                                    : undefined;
                            }}
                            onPress={openProfile}
                            renderActions={(person) => {
                                const np = listeningById.get(
                                    person.user_id,
                                )?.now_playing;
                                if (!np) return null;
                                return (
                                    <View className="items-center gap-1">
                                        <SmallArt url={np.artwork_url} />
                                        {np.live_session_id ? (
                                            <LiveChip />
                                        ) : null}
                                    </View>
                                );
                            }}
                        />
                    ) : null}
                    {notListening.length > 0 ? (
                        <PersonSection
                            title="Friends"
                            people={notListening}
                            online={(person) =>
                                isFriendOnline(person, listeningIds)
                            }
                            onPress={openProfile}
                            renderActions={(person) => {
                                const { favorite } = person;
                                return (
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={
                                            favorite
                                                ? `Remove ${person.username} from favorites`
                                                : `Favorite ${person.username}`
                                        }
                                        accessibilityState={{
                                            selected: favorite,
                                        }}
                                        disabled={favoriteLoading}
                                        hitSlop={8}
                                        onPress={() =>
                                            void setFavorite(
                                                person.user_id,
                                                !favorite,
                                            )
                                        }
                                        className="active:opacity-60"
                                    >
                                        <Ionicons
                                            name={
                                                favorite
                                                    ? "star"
                                                    : "star-outline"
                                            }
                                            size={20}
                                            color={
                                                favorite
                                                    ? brand
                                                    : mutedForeground
                                            }
                                        />
                                    </Pressable>
                                );
                            }}
                        />
                    ) : null}
                    {outgoing.length > 0 ? (
                        <PersonSection
                            title="Sent"
                            people={outgoing}
                            onPress={openProfile}
                            renderActions={(person) => (
                                <Button
                                    accessibilityLabel={`Cancel request to ${person.username}`}
                                    className="w-9 px-0"
                                    size="sm"
                                    variant="outline"
                                    disabled={requestBusy}
                                    onPress={() =>
                                        void cancelFriendRequest({
                                            user_id: person.user_id,
                                        })
                                    }
                                >
                                    <Ionicons
                                        name="close"
                                        size={18}
                                        color={foreground}
                                    />
                                </Button>
                            )}
                        />
                    ) : null}
                    {blocked.length > 0 ? (
                        <PersonSection
                            title="Blocked"
                            people={blocked}
                            onPress={openProfile}
                            renderActions={(person) => (
                                <Button
                                    accessibilityLabel={`Unblock ${person.username}`}
                                    size="sm"
                                    variant="outline"
                                    disabled={blockLoading}
                                    onPress={async () => {
                                        try {
                                            await setBlocked(
                                                person.user_id,
                                                false,
                                            );
                                            showToast(
                                                `Unblocked ${person.username}`,
                                            );
                                        } catch {
                                            showToast(
                                                `Couldn't unblock ${person.username}`,
                                                true,
                                            );
                                        }
                                    }}
                                >
                                    <Text>Unblock</Text>
                                </Button>
                            )}
                        />
                    ) : null}
                    {friendshipsErr ? (
                        <ErrorNotice error={friendshipsErr} className="mt-6" />
                    ) : friendshipsLoading && nobody ? (
                        <View className="mt-6">
                            <GlassPanel>
                                {[0, 1, 2].map((i) => (
                                    <View
                                        key={i}
                                        className="flex-row items-center gap-3 px-4 py-3"
                                    >
                                        <Skeleton className="h-10 w-10 rounded-full" />
                                        <Skeleton className="h-4 w-32 rounded" />
                                    </View>
                                ))}
                            </GlassPanel>
                        </View>
                    ) : nobody ? (
                        <View className="items-center gap-1 py-16">
                            <Text className="text-base font-semibold text-foreground">
                                No friends yet.
                            </Text>
                            <Text className="text-center text-sm text-muted-foreground">
                                Open someone&apos;s profile from a post to add
                                them.
                            </Text>
                        </View>
                    ) : null}
                </Animated.ScrollView>
            </ScreenScrollMarker>
            <Toast toast={toast} />
        </View>
    );
}

function SearchSection({ onPress }: { onPress: (userId: string) => void }) {
    const { height: screenHeight } = useWindowDimensions();
    const [query, setQuery] = useState("");
    const [headerHeight, setHeaderHeight] = useState(0);
    const sectionMaxHeight = screenHeight / 2;
    const listMaxHeight = Math.max(0, sectionMaxHeight - headerHeight);
    const settled = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
    // clearing the field drops the list at once, with no pause
    const term = query.trim() && settled ? settled : "";
    const { foreground } = useAppTheme().colors;
    const { users, userSearchLoading, userSearchErr } = useUserSearch(term);
    const shown = term.length > 0 ? users : [];
    const status =
        term.length === 0
            ? null
            : userSearchErr
              ? "Couldn't search."
              : userSearchLoading && shown.length === 0
                ? "Loading..."
                : shown.length === 0
                  ? "No people found."
                  : null;

    return (
        <View style={{ maxHeight: sectionMaxHeight }}>
            <View
                className="gap-2 pb-2 pt-3"
                onLayout={(event) =>
                    setHeaderHeight(event.nativeEvent.layout.height)
                }
            >
                <Text className="text-sm font-semibold text-muted-foreground">
                    search
                </Text>
                <Input
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Find people"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    accessibilityLabel="Search people"
                />
            </View>
            <ScrollView
                style={{ maxHeight: listMaxHeight }}
                contentContainerClassName="pb-3"
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
            >
                {shown.map((person) => (
                    <PersonRow
                        key={person.user_id}
                        person={person}
                        onPress={onPress}
                        actions={
                            person.is_friend ? (
                                <Ionicons
                                    name="people"
                                    size={18}
                                    color={foreground}
                                    accessibilityLabel="Friend"
                                />
                            ) : null
                        }
                    />
                ))}
                {status ? (
                    <Text className="py-2 text-sm text-muted-foreground">
                        {status}
                    </Text>
                ) : null}
            </ScrollView>
        </View>
    );
}

function PersonRow({
    person,
    onPress,
    actions,
}: {
    person: SocialPerson;
    onPress?: (userId: string) => void;
    actions?: ReactNode;
}) {
    const identity = (
        <>
            <Initials username={person.username} />
            <Text
                className="min-w-0 flex-1 text-base text-foreground"
                numberOfLines={1}
            >
                {person.username}
            </Text>
        </>
    );

    return (
        <View className="flex-row items-center gap-3 py-2">
            {onPress ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={person.username}
                    onPress={() => onPress(person.user_id)}
                    className="min-w-0 flex-1 flex-row items-center gap-3 active:opacity-60"
                >
                    {identity}
                </Pressable>
            ) : (
                <View className="min-w-0 flex-1 flex-row items-center gap-3">
                    {identity}
                </View>
            )}
            {actions}
        </View>
    );
}

function PersonSection<Person extends SocialPerson>({
    title,
    people,
    online,
    subtitle,
    onPress,
    renderActions,
}: {
    title: string;
    people: Person[];
    /** Which avatars get the green dot. None when left out. */
    online?: (person: Person) => boolean;
    subtitle?: (person: Person) => string | undefined;
    onPress: (userId: string) => void;
    renderActions?: (person: Person) => ReactNode;
}) {
    return (
        <View className="mt-6 gap-2">
            <Text className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {title}
            </Text>
            <GlassPanel>
                {people.map((person, index) => {
                    const line = subtitle?.(person);
                    return (
                        <View key={person.user_id}>
                            {index > 0 ? (
                                <View className="ml-[68px] h-px bg-border" />
                            ) : null}
                            <View className="flex-row items-center gap-3 px-4 py-3">
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={person.username}
                                    onPress={() => onPress(person.user_id)}
                                    className="min-w-0 flex-1 flex-row items-center gap-3 active:opacity-60"
                                >
                                    <Initials
                                        username={person.username}
                                        online={online?.(person) ?? false}
                                    />
                                    <View className="min-w-0 flex-1">
                                        <Text
                                            className="text-base text-foreground"
                                            numberOfLines={1}
                                        >
                                            {person.username}
                                        </Text>
                                        {line ? (
                                            <Text
                                                className="text-xs text-muted-foreground"
                                                numberOfLines={1}
                                            >
                                                {line}
                                            </Text>
                                        ) : null}
                                    </View>
                                </Pressable>
                                {renderActions?.(person)}
                            </View>
                        </View>
                    );
                })}
            </GlassPanel>
        </View>
    );
}

function SmallArt({ url }: { url: string | null }) {
    return isUsableArtworkUrl(url) ? (
        <Image
            source={{ uri: url! }}
            className="rounded-lg bg-muted"
            style={{ width: 40, height: 40 }}
        />
    ) : (
        <View className="h-10 w-10 rounded-lg bg-muted" />
    );
}

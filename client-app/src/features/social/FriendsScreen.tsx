import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation, useRouter } from "expo-router";
import {
    useCallback,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import Animated from "react-native-reanimated";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import {
    useAcceptFriendRequest,
    useCancelFriendRequest,
    useFriendships,
    useUserSearch,
} from "@/lib/routes/social";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { useAppTheme } from "@/lib/theme";
import type { SocialPerson } from "@/lib/types";
import { useDebouncedValue } from "@/lib/use-debounced-value";

import { initialsFromUsername } from "./format";

/** How long typing has to pause before a user search runs. */
const SEARCH_DEBOUNCE_MS = 300;

/** Search, then incoming requests, outgoing requests, and friends. */
export function FriendsScreen() {
    const navigation = useNavigation();
    const router = useRouter();
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll();
    const { foreground, primaryForeground } = useAppTheme().colors;
    const { incoming, outgoing, friends, friendshipsLoading, friendshipsErr } =
        useFriendships();
    const { acceptFriendRequest, acceptFriendRequestLoading } =
        useAcceptFriendRequest();
    const { cancelFriendRequest, cancelFriendRequestLoading } =
        useCancelFriendRequest();
    const requestBusy =
        acceptFriendRequestLoading || cancelFriendRequestLoading;
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

    useLayoutEffect(() => {
        navigation.setOptions({ title: "Friends" });
    }, [navigation]);

    const friendsLabel =
        friends.length > 0
            ? null
            : friendshipsLoading
              ? "Loading..."
              : friendshipsErr
                ? "Couldn't load friends."
                : "No friends yet.";

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
                            title="Incoming requests"
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
                    {outgoing.length > 0 ? (
                        <PersonSection
                            title="outgoing requests"
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
                    <PersonSection
                        title="friends"
                        people={friends}
                        emptyLabel={friendsLabel}
                        onPress={openProfile}
                    />
                </Animated.ScrollView>
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
        </View>
    );
}

function SearchSection({
    onPress,
}: {
    onPress: (userId: string) => void;
}) {
    const { height: screenHeight } = useWindowDimensions();
    const [query, setQuery] = useState("");
    const [headerHeight, setHeaderHeight] = useState(0);
    const sectionMaxHeight = screenHeight / 2;
    const listMaxHeight = Math.max(0, sectionMaxHeight - headerHeight);
    const settled = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
    // clearing the field drops the list at once, with no pause
    const term = query.trim() && settled ? settled : "";
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
            <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
                <Text className="text-sm font-semibold text-foreground">
                    {initialsFromUsername(person.username)}
                </Text>
            </View>
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

function PersonSection({
    title,
    people,
    emptyLabel,
    onPress,
    renderActions,
}: {
    title: string;
    people: SocialPerson[];
    emptyLabel?: string | null;
    onPress: (userId: string) => void;
    renderActions?: (person: SocialPerson) => ReactNode;
}) {
    return (
        <View className="gap-2 py-3">
            <Text className="text-sm font-semibold text-muted-foreground">
                {title}
            </Text>
            {people.map((person) => (
                <PersonRow
                    key={person.user_id}
                    person={person}
                    onPress={onPress}
                    actions={renderActions?.(person)}
                />
            ))}
            {emptyLabel ? (
                <Text className="py-2 text-sm text-muted-foreground">
                    {emptyLabel}
                </Text>
            ) : null}
        </View>
    );
}

import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { SearchField } from "@/components/custom/search-field";
import { Text } from "@/components/ui/text";
import { useFriendships } from "@/lib/routes/social";

import { Initials } from "../social/MemberRow";

/** The results scroll past this height, so the popup stays on screen. */
const RESULTS_MAX_HEIGHT = 200;

/**
 * The bottom of the live session's invite popup: search the caller's friends
 * by username and invite one. Frontend only for now: Invite marks the row as
 * sent in this popup and nothing reaches the backend. Friends already in the
 * session (`memberIds`) show as In session instead.
 */
export function InviteFriendsSection({ memberIds }: { memberIds: string[] }) {
    const { friends, friendshipsLoading, friendshipsErr } = useFriendships();
    const [query, setQuery] = useState("");
    const [invited, setInvited] = useState<ReadonlySet<string>>(new Set());

    const search = query.trim().toLowerCase();
    const matches = useMemo(
        () =>
            search.length === 0
                ? []
                : friends.filter((friend) =>
                      friend.username.toLowerCase().includes(search),
                  ),
        [friends, search],
    );
    const inSession = useMemo(() => new Set(memberIds), [memberIds]);

    const status =
        search.length === 0
            ? null
            : friendshipsErr
              ? "Couldn't load your friends."
              : friendshipsLoading && friends.length === 0
                ? "Loading..."
                : matches.length === 0
                  ? "No friends found."
                  : null;

    return (
        <View className="gap-2 border-t border-border pt-4">
            <Text className="text-sm text-muted-foreground">
                Invite friends
            </Text>
            <SearchField
                size="sm"
                surface="outline"
                value={query}
                onChangeText={setQuery}
                placeholder="Search friends"
            />
            {matches.length > 0 ? (
                <ScrollView
                    style={{ maxHeight: RESULTS_MAX_HEIGHT }}
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                >
                    {matches.map((friend) => {
                        const member = inSession.has(friend.user_id);
                        const sent = invited.has(friend.user_id);
                        return (
                            <View
                                key={friend.user_id}
                                className="flex-row items-center gap-3 py-2"
                            >
                                <Initials
                                    username={friend.username}
                                    size={32}
                                    online={friend.online}
                                />
                                <Text
                                    className="min-w-0 flex-1 font-semibold text-foreground"
                                    numberOfLines={1}
                                >
                                    {friend.username}
                                </Text>
                                {member || sent ? (
                                    <Text className="text-sm text-muted-foreground">
                                        {member ? "In session" : "Invited"}
                                    </Text>
                                ) : (
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`Invite ${friend.username}`}
                                        hitSlop={8}
                                        onPress={() =>
                                            setInvited((prev) =>
                                                new Set(prev).add(
                                                    friend.user_id,
                                                ),
                                            )
                                        }
                                        className="rounded-full bg-brand px-3 py-1 active:opacity-60"
                                    >
                                        <Text className="text-sm font-semibold text-white">
                                            Invite
                                        </Text>
                                    </Pressable>
                                )}
                            </View>
                        );
                    })}
                </ScrollView>
            ) : null}
            {status ? (
                <Text className="text-sm text-muted-foreground">{status}</Text>
            ) : null}
        </View>
    );
}

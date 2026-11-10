import { useNavigation, useRouter, type Href } from "expo-router";
import { useLayoutEffect, useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";

import { ErrorNotice } from "@/components/custom/error-notice";
import { InviteCodePopup } from "@/components/custom/invite-code-popup";
import { GlassPanel } from "@/components/ui/glass-panel";
import { GlassPill } from "@/components/ui/glass-pill";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import {
    useSharedPlaylist,
    useSharedPlaylistWrites,
    type SharedPlaylistMember,
} from "@/lib/routes/shared-playlists";
import { useFriendships } from "@/lib/routes/social";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";

import { MemberRow, RoleMenu } from "../social/MemberRow";
import { ASSIGNABLE_ROLES, roleLabel } from "./roles";

/**
 * Who is in a shared playlist. The owner taps a member to change their role
 * or remove them, invites by code, and adds friends directly when their
 * privacy settings allow it.
 */
export function SharedPlaylistMembersScreen({
    playlistId,
}: {
    playlistId: number;
}) {
    const navigation = useNavigation();
    const router = useRouter();
    const { account } = useAccount();
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll();
    const { sharedPlaylist: playlist, sharedPlaylistErr } =
        useSharedPlaylist(playlistId);
    const writes = useSharedPlaylistWrites(playlistId);
    const { friends } = useFriendships();
    const [menuFor, setMenuFor] = useState<SharedPlaylistMember | null>(null);
    const [inviting, setInviting] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    useLayoutEffect(() => {
        navigation.setOptions({ title: "Members" });
    }, [navigation]);

    const isOwner = playlist?.my_role === "owner";
    const memberIds = new Set(playlist?.members.map((m) => m.user_id));
    const addable = friends.filter((friend) => !memberIds.has(friend.user_id));

    async function addFriend(userId: string, username: string) {
        setMessage(null);
        try {
            await writes.addMember({ user_id: userId, role: "viewer" });
        } catch (error) {
            const forbidden =
                (error as { error_type?: string })?.error_type === "Forbidden";
            setMessage(
                forbidden
                    ? `${username} only accepts invites by code.`
                    : `Couldn't add ${username}.`,
            );
        }
    }

    return (
        <View className="flex-1 bg-background">
            <ScreenScrollMarker>
                <Animated.ScrollView
                    {...scroll}
                    className="flex-1"
                    contentContainerStyle={[
                        {
                            paddingHorizontal: 20,
                            paddingTop: 8,
                            paddingBottom: listBottomInset + 48,
                            gap: 24,
                        },
                        scroll.contentContainerStyle,
                    ]}
                    showsVerticalScrollIndicator={false}
                >
                    {sharedPlaylistErr ? (
                        <ErrorNotice error={sharedPlaylistErr} />
                    ) : null}
                    {playlist ? (
                        <GlassPanel>
                            {playlist.members.map((member, index) => (
                                <View key={member.user_id}>
                                    {index > 0 ? (
                                        <View className="ml-[68px] h-px bg-border" />
                                    ) : null}
                                    <MemberRow
                                        username={member.username}
                                        isYou={member.user_id === account?.id}
                                        roleLabel={roleLabel(member.role)}
                                        manageable={
                                            isOwner && member.role !== "owner"
                                        }
                                        onPress={() =>
                                            isOwner && member.role !== "owner"
                                                ? setMenuFor(member)
                                                : router.push(
                                                      `/social/user/${member.user_id}` as Href,
                                                  )
                                        }
                                    />
                                </View>
                            ))}
                        </GlassPanel>
                    ) : null}

                    {isOwner ? (
                        <View className="items-center">
                            <GlassPill
                                icon="person-add-outline"
                                label="Invite with code"
                                onPress={() => setInviting(true)}
                            />
                        </View>
                    ) : null}

                    {isOwner && addable.length > 0 ? (
                        <View className="gap-2">
                            <Text className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                                Add friends
                            </Text>
                            <GlassPanel>
                                {addable.map((friend, index) => (
                                    <View key={friend.user_id}>
                                        {index > 0 ? (
                                            <View className="ml-[68px] h-px bg-border" />
                                        ) : null}
                                        <MemberRow
                                            username={friend.username}
                                            roleLabel="Add"
                                            trailing={
                                                <GlassPill
                                                    size="sm"
                                                    icon="add"
                                                    label="Add"
                                                    accessibilityLabel={`Add ${friend.username}`}
                                                    onPress={() =>
                                                        void addFriend(
                                                            friend.user_id,
                                                            friend.username,
                                                        )
                                                    }
                                                />
                                            }
                                        />
                                    </View>
                                ))}
                            </GlassPanel>
                            {message ? (
                                <Text className="text-sm text-muted-foreground">
                                    {message}
                                </Text>
                            ) : null}
                        </View>
                    ) : null}
                </Animated.ScrollView>
            </ScreenScrollMarker>

            {menuFor ? (
                <RoleMenu
                    username={menuFor.username}
                    roles={ASSIGNABLE_ROLES}
                    current={menuFor.role === "editor" ? "editor" : "viewer"}
                    removeLabel="Remove from playlist"
                    onPick={(role) =>
                        void writes.setMemberRole({
                            user_id: menuFor.user_id,
                            role,
                        })
                    }
                    onViewProfile={() =>
                        router.push(`/social/user/${menuFor.user_id}` as Href)
                    }
                    onRemove={() =>
                        void writes.removeMember({ user_id: menuFor.user_id })
                    }
                    onClose={() => setMenuFor(null)}
                />
            ) : null}

            {inviting && playlist ? (
                <InviteCodePopup
                    title={playlist.name}
                    withRole
                    createInvite={writes.createInvite}
                    onClose={() => setInviting(false)}
                />
            ) : null}
        </View>
    );
}

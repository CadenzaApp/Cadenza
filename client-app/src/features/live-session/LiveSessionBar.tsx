import type { Href } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";

import { InviteCodePopup } from "@/components/custom/invite-code-popup";
import {
    PlayerBarButton,
    PlayerBarShell,
} from "@/components/custom/media-player/player-bar";
import { ModalPopup } from "@/components/custom/modal-popup";
import { SongSearchSheet } from "@/components/custom/song-search-sheet";
import { useAccount } from "@/lib/account";
import { useOpenScreen } from "@/lib/open-screen";
import { useSessionChatUnread } from "@/lib/routes/live-session-chat";
import {
    SESSION_ROLE_LABELS,
    useLiveSessionWrites,
    type LiveSession,
    type LiveSessionMember,
    type SessionRole,
} from "@/lib/routes/live-sessions";

import { MemberRow, RoleMenu } from "../social/MemberRow";
import { ChatSheet } from "./ChatSheet";
import { InviteFriendsSection } from "./InviteFriendsSection";
import { sessionSongs } from "./session-commands";
import { RequestsSheet } from "./RequestsSheet";
import { ROLE_CHOICES, useRunSessionWrite } from "./session-parts";

type Open = "requests" | "people" | "chat" | "add" | "invite" | null;

/** Lists in a popup scroll past this height. */
const LIST_MAX_HEIGHT = 420;

/**
 * The now playing sheet's bottom bar in a live session, in place of the page
 * tabs: Requests (the host, controllers, and queue editors), People, Chat
 * (everyone), Add songs, and Invite (the host's), as the caller's role allows.
 * The bar is only as wide as the buttons it has. Requests and Chat open in a
 * bottom sheet; Chat badges messages from others since it was last open. The host can make anyone else host from
 * People, and stays in as a controller. The queue itself is the player's own.
 */
export function LiveSessionBar({ session }: { session: LiveSession }) {
    const { account } = useAccount();
    const openScreen = useOpenScreen();
    const writes = useLiveSessionWrites(session.session_id);
    const runSessionWrite = useRunSessionWrite();
    const isHost = session.my_role === "host";
    const [open, setOpen] = useState<Open>(null);
    const [memberMenu, setMemberMenu] = useState<LiveSessionMember | null>(
        null,
    );

    const canReview = session.can.review;
    const requests = session.suggestions.length + session.join_requests.length;
    const canSuggest = session.can.suggest;
    const unread = useSessionChatUnread(session.session_id);
    const buttonCount =
        2 + (canReview ? 1 : 0) + (canSuggest ? 1 : 0) + (isHost ? 1 : 0);

    function openProfile(userId: string) {
        openScreen(`/social/user/${userId}` as Href, { closing: "player" });
    }

    function confirmMakeHost(member: LiveSessionMember) {
        Alert.alert(
            `Make ${member.username} host?`,
            "Their phone plays the session from here. You stay in as a controller.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Make host",
                    onPress: () =>
                        void runSessionWrite(
                            () => writes.transferHost(member.user_id),
                            "Couldn't make them host.",
                        ),
                },
            ],
        );
    }

    return (
        <>
            <PlayerBarShell itemCount={buttonCount}>
                {canReview ? (
                    <PlayerBarButton
                        sf="hand.raised"
                        icon="hand-left-outline"
                        label="Requests"
                        accessibilityLabel={`Requests, ${requests}`}
                        badge={requests}
                        onPress={() => setOpen("requests")}
                    />
                ) : null}
                <PlayerBarButton
                    sf="person.2"
                    icon="people-outline"
                    label={`People (${session.members.length})`}
                    accessibilityLabel={`People, ${session.members.length}`}
                    onPress={() => setOpen("people")}
                />
                <PlayerBarButton
                    sf="bubble.left.and.bubble.right"
                    icon="chatbubbles-outline"
                    label="Chat"
                    accessibilityLabel={
                        unread > 0 ? `Chat, ${unread} new` : "Chat"
                    }
                    badge={unread}
                    onPress={() => setOpen("chat")}
                />
                {canSuggest ? (
                    <PlayerBarButton
                        sf="plus.circle"
                        icon="add-circle-outline"
                        label={session.can.edit_queue ? "Add" : "Suggest"}
                        onPress={() => setOpen("add")}
                    />
                ) : null}
                {isHost ? (
                    <PlayerBarButton
                        sf="person.badge.plus"
                        icon="person-add-outline"
                        label="Invite"
                        accessibilityLabel="Invite people"
                        onPress={() => setOpen("invite")}
                    />
                ) : null}
            </PlayerBarShell>

            <RequestsSheet
                session={session}
                visible={open === "requests"}
                onClose={() => setOpen(null)}
            />

            <ChatSheet
                sessionId={session.session_id}
                visible={open === "chat"}
                onClose={() => setOpen(null)}
                onOpenProfile={(userId) => {
                    setOpen(null);
                    openProfile(userId);
                }}
            />

            <ModalPopup
                visible={open === "people"}
                onClose={() => setOpen(null)}
                title="People"
            >
                <ScrollView style={{ maxHeight: LIST_MAX_HEIGHT }}>
                    {session.members.map((member, index) => (
                        <View key={member.user_id}>
                            {index > 0 ? (
                                <View className="ml-[68px] h-px bg-border" />
                            ) : null}
                            <MemberRow
                                username={member.username}
                                isYou={member.user_id === account?.id}
                                roleLabel={
                                    member.is_host
                                        ? "Host"
                                        : SESSION_ROLE_LABELS[member.role]
                                }
                                subtitle={
                                    member.listen_mode === "synced"
                                        ? "Listening here"
                                        : "Remote"
                                }
                                subtitleIcon={
                                    member.listen_mode === "synced"
                                        ? "volume-high-outline"
                                        : "phone-portrait-outline"
                                }
                                manageable={isHost && !member.is_host}
                                onPress={() => {
                                    // one popup at a time
                                    setOpen(null);
                                    if (isHost && !member.is_host) {
                                        setMemberMenu(member);
                                    } else {
                                        openProfile(member.user_id);
                                    }
                                }}
                            />
                        </View>
                    ))}
                </ScrollView>
            </ModalPopup>

            {memberMenu ? (
                <RoleMenu<SessionRole>
                    username={memberMenu.username}
                    roles={ROLE_CHOICES}
                    current={memberMenu.role}
                    removeLabel="Remove from session"
                    extras={[
                        {
                            id: "make-host",
                            label: "Make host",
                            icon: "star-outline",
                            onPress: () => confirmMakeHost(memberMenu),
                        },
                    ]}
                    onPick={(newRole) =>
                        void runSessionWrite(
                            () =>
                                writes.setMemberRole({
                                    user_id: memberMenu.user_id,
                                    role: newRole,
                                }),
                            "Couldn't change the role.",
                        )
                    }
                    onViewProfile={() => openProfile(memberMenu.user_id)}
                    onRemove={() =>
                        void runSessionWrite(
                            () => writes.kickMember(memberMenu.user_id),
                            "Couldn't remove them.",
                        )
                    }
                    onClose={() => setMemberMenu(null)}
                />
            ) : null}

            {open === "add" ? (
                <SongSearchSheet
                    title={
                        session.can.edit_queue ? "Add songs" : "Suggest a song"
                    }
                    actionLabel={session.can.edit_queue ? "Add" : "Suggest"}
                    onClose={() => setOpen(null)}
                    onPick={async (song) => {
                        const songs = sessionSongs([song]);
                        if (songs.length > 0) await writes.addSongs({ songs });
                    }}
                />
            ) : null}

            {open === "invite" ? (
                <InviteCodePopup
                    title={session.name}
                    createInvite={writes.createInvite}
                    onClose={() => setOpen(null)}
                >
                    <InviteFriendsSection
                        memberIds={session.members.map((m) => m.user_id)}
                    />
                </InviteCodePopup>
            ) : null}
        </>
    );
}

import Ionicons from "@expo/vector-icons/Ionicons";
import type { Href } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";

import { InviteCodePopup } from "@/components/custom/invite-code-popup";
import {
    PlayerBarButton,
    PlayerBarShell,
} from "@/components/custom/media-player/player-bar";
import { ModalPopup } from "@/components/custom/modal-popup";
import { SongSearchSheet } from "@/components/custom/song-search-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useOpenScreen } from "@/lib/open-screen";
import {
    SESSION_ROLE_LABELS,
    sessionCan,
    useLiveSessionWrites,
    type LiveSession,
    type LiveSessionMember,
    type SessionRole,
} from "@/lib/routes/live-sessions";
import { useAppTheme } from "@/lib/theme";

import { MemberRow, RoleMenu } from "../social/MemberRow";
import { sessionSongs } from "./session-commands";
import { EntryRow, ROLE_CHOICES, errorType } from "./session-parts";

type Open = "requests" | "people" | "add" | "share" | null;

/** Lists in a popup scroll past this height. */
const LIST_MAX_HEIGHT = 420;

/**
 * The now playing sheet's bottom bar in a live session, in place of the page
 * tabs: Requests, People, Add songs, and Share, as the caller's role allows.
 * The queue itself is the player's own.
 */
export function LiveSessionBar({ session }: { session: LiveSession }) {
    const { account } = useAccount();
    const { colors } = useAppTheme();
    const openScreen = useOpenScreen();
    const writes = useLiveSessionWrites(session.session_id);
    const role = session.my_role;
    const isHost = role === "host";
    const [open, setOpen] = useState<Open>(null);
    const [memberMenu, setMemberMenu] = useState<LiveSessionMember | null>(
        null,
    );

    const requests = isHost
        ? session.suggestions
        : session.suggestions.filter((entry) => entry.added_by === account?.id);

    async function run(action: () => Promise<unknown>, failure: string) {
        try {
            await action();
        } catch (error) {
            Alert.alert(
                "Live session",
                errorType(error) === "Forbidden"
                    ? "Your role does not allow that."
                    : failure,
            );
        }
    }

    function openProfile(userId: string) {
        openScreen(`/social/user/${userId}` as Href, { closing: "player" });
    }

    return (
        <>
            <PlayerBarShell>
                {sessionCan.suggest(role) ? (
                    <PlayerBarButton
                        icon="hand-left-outline"
                        label="Requests"
                        accessibilityLabel={`Requests, ${requests.length}`}
                        badge={
                            isHost
                                ? requests.length + session.join_requests.length
                                : undefined
                        }
                        onPress={() => setOpen("requests")}
                    />
                ) : null}
                <PlayerBarButton
                    icon="people-outline"
                    label={`People (${session.members.length})`}
                    accessibilityLabel={`People, ${session.members.length}`}
                    onPress={() => setOpen("people")}
                />
                {sessionCan.suggest(role) ? (
                    <PlayerBarButton
                        icon="add-circle-outline"
                        label={sessionCan.editQueue(role) ? "Add" : "Suggest"}
                        onPress={() => setOpen("add")}
                    />
                ) : null}
                {isHost ? (
                    <PlayerBarButton
                        icon="share-outline"
                        label="Share"
                        accessibilityLabel="Invite people"
                        onPress={() => setOpen("share")}
                    />
                ) : null}
            </PlayerBarShell>

            <ModalPopup
                visible={open === "requests"}
                onClose={() => setOpen(null)}
                title="Requests"
            >
                {session.join_requests.length > 0 ? (
                    <View className="pb-2">
                        <Text className="px-1 pb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                            Want to join
                        </Text>
                        {session.join_requests.map((request) => (
                            <View
                                key={request.user_id}
                                className="h-14 flex-row items-center gap-3 px-4"
                            >
                                <Text
                                    className="min-w-0 flex-1 text-base font-medium text-foreground"
                                    numberOfLines={1}
                                >
                                    {request.username}
                                </Text>
                                <Button
                                    accessibilityLabel={`Don't let ${request.username} in`}
                                    className="w-9 px-0"
                                    size="sm"
                                    variant="outline"
                                    onPress={() =>
                                        void run(
                                            () =>
                                                writes.answerJoinRequest(
                                                    request.user_id,
                                                    false,
                                                ),
                                            "Couldn't answer.",
                                        )
                                    }
                                >
                                    <Ionicons
                                        name="close"
                                        size={18}
                                        color={colors.foreground}
                                    />
                                </Button>
                                <Button
                                    accessibilityLabel={`Let ${request.username} in`}
                                    className="w-9 px-0"
                                    size="sm"
                                    onPress={() =>
                                        void run(
                                            () =>
                                                writes.answerJoinRequest(
                                                    request.user_id,
                                                    true,
                                                ),
                                            "Couldn't let them in.",
                                        )
                                    }
                                >
                                    <Ionicons
                                        name="checkmark"
                                        size={18}
                                        color={colors.primaryForeground}
                                    />
                                </Button>
                            </View>
                        ))}
                    </View>
                ) : null}
                {requests.length === 0 ? (
                    <Text className="py-4 text-center text-sm text-muted-foreground">
                        {isHost
                            ? "No suggestions waiting."
                            : "You have no suggestions waiting."}
                    </Text>
                ) : (
                    <ScrollView style={{ maxHeight: LIST_MAX_HEIGHT }}>
                        {requests.map((entry, index) => (
                            <EntryRow
                                key={entry.entry_id}
                                entry={entry}
                                first={index === 0}
                                trailing={
                                    isHost ? (
                                        <View className="flex-row gap-2">
                                            <Button
                                                accessibilityLabel={`Reject ${entry.title} from ${entry.added_by_username ?? "someone"}`}
                                                className="w-9 px-0"
                                                size="sm"
                                                variant="outline"
                                                onPress={() =>
                                                    void run(
                                                        () =>
                                                            writes.reviewSuggestion(
                                                                entry.entry_id,
                                                                false,
                                                            ),
                                                        "Couldn't reject it.",
                                                    )
                                                }
                                            >
                                                <Ionicons
                                                    name="close"
                                                    size={18}
                                                    color={colors.foreground}
                                                />
                                            </Button>
                                            <Button
                                                accessibilityLabel={`Approve ${entry.title} from ${entry.added_by_username ?? "someone"}`}
                                                className="w-9 px-0"
                                                size="sm"
                                                onPress={() =>
                                                    void run(
                                                        () =>
                                                            writes.reviewSuggestion(
                                                                entry.entry_id,
                                                                true,
                                                            ),
                                                        "Couldn't approve it.",
                                                    )
                                                }
                                            >
                                                <Ionicons
                                                    name="checkmark"
                                                    size={18}
                                                    color={
                                                        colors.primaryForeground
                                                    }
                                                />
                                            </Button>
                                        </View>
                                    ) : (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={`Withdraw ${entry.title}`}
                                            onPress={() =>
                                                void run(
                                                    () =>
                                                        writes.removeEntry(
                                                            entry.entry_id,
                                                        ),
                                                    "Couldn't withdraw it.",
                                                )
                                            }
                                            className="active:opacity-60"
                                        >
                                            <Text className="text-xs text-muted-foreground">
                                                Withdraw
                                            </Text>
                                        </Pressable>
                                    )
                                }
                            />
                        ))}
                    </ScrollView>
                )}
            </ModalPopup>

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
                    onPick={(newRole) =>
                        void run(
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
                        void run(
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
                        sessionCan.editQueue(role)
                            ? "Add songs"
                            : "Suggest a song"
                    }
                    actionLabel={sessionCan.editQueue(role) ? "Add" : "Suggest"}
                    onClose={() => setOpen(null)}
                    onPick={async (song) => {
                        const songs = sessionSongs([song]);
                        if (songs.length > 0) await writes.addSongs({ songs });
                    }}
                />
            ) : null}

            {open === "share" ? (
                <InviteCodePopup
                    title={session.name}
                    createInvite={writes.createInvite}
                    onClose={() => setOpen(null)}
                />
            ) : null}
        </>
    );
}

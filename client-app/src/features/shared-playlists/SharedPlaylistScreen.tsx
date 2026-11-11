import type { MusicItem } from "@apple-musickit";
import { ShuffleMode } from "@apple-musickit";
import { useRouter, type Href } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { ErrorNotice } from "@/components/custom/error-notice";
import { InviteCodePopup } from "@/components/custom/invite-code-popup";
import { ModalPopup } from "@/components/custom/modal-popup";
import type { MusicListTrackAction } from "@/components/custom/music-list/types";
import { SongSearchSheet } from "@/components/custom/song-search-sheet";
import {
    TrackCollectionView,
    type TrackCollectionOption,
} from "@/components/custom/track-collection-view";
import { FloatingBackButton } from "@/components/ui/floating-back-button";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassConfirmDialog } from "@/components/ui/glass-confirm-dialog";
import { GlassInput } from "@/components/ui/glass-input";
import { GlassPill } from "@/components/ui/glass-pill";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { usePlaylistMutations } from "@/lib/musickit-hooks";
import type { PlaySource } from "@/lib/play-source";
import { usePlaybackCommands } from "@/lib/playback";
import {
    canEditSongs,
    useSharedPlaylist,
    useSharedPlaylistWrites,
    type SharedPlaylistEntry,
} from "@/lib/routes/shared-playlists";
import { useCreatePost } from "@/lib/routes/social";

import { CreatePostDialog } from "../social/CreatePostDialog";
import { Initials } from "../social/MemberRow";
import { SharedPlaylistPostCard } from "../social/SharedPlaylistPostCard";
import { entryIdOf, usePlaylistTracks } from "./use-playlist-tracks";

/** Diameter of the floating back button, matching other collections. */
const HERO_BUTTON_SIZE = 52;
/** Members shown in the header before "+N". */
const MEMBER_STACK = 4;

/** Whether an error is the backend's stale version refusal. */
function isVersionConflict(error: unknown) {
    return (
        typeof error === "object" &&
        error !== null &&
        (error as { error_type?: string }).error_type === "VersionConflict"
    );
}

/**
 * One shared playlist: cover, members, songs. Editors add, remove, and move
 * songs; the owner also renames, invites, and deletes. Everyone can play it
 * and save a copy to Apple Music. Changes from other members arrive through
 * the realtime socket.
 */
export function SharedPlaylistScreen({ playlistId }: { playlistId: number }) {
    const router = useRouter();
    const { account } = useAccount();
    const { playQueue, setShuffleMode, togglePlayback } = usePlaybackCommands();
    const { createPlaylist } = usePlaylistMutations();
    const {
        sharedPlaylist: playlist,
        sharedPlaylistLoading,
        sharedPlaylistErr,
        reloadSharedPlaylist,
    } = useSharedPlaylist(playlistId);
    const writes = useSharedPlaylistWrites(playlistId);

    const [optionsOpen, setOptionsOpen] = useState(false);
    const [inviteOpen, setInviteOpen] = useState(false);
    const [adding, setAdding] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [confirmLeave, setConfirmLeave] = useState(false);
    const [sharing, setSharing] = useState(false);
    const { createPost } = useCreatePost();
    const [notice, setNotice] = useState<string | null>(null);
    const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showNotice = useCallback((message: string) => {
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        setNotice(message);
        noticeTimer.current = setTimeout(() => setNotice(null), 3000);
    }, []);

    const reorderHref = `/social/playlist/${playlistId}/reorder` as Href;
    const role = playlist?.my_role;
    const isOwner = role === "owner";
    const editable = canEditSongs(role);
    const entries = useMemo(() => playlist?.entries ?? [], [playlist]);

    const {
        songIds,
        tracks,
        tracksLoading: songInfoLoading,
    } = usePlaylistTracks(entries);

    const source = useMemo<PlaySource | undefined>(
        () =>
            playlist
                ? {
                      kind: "shared_playlist",
                      id: String(playlist.playlist_id),
                      name: playlist.name,
                  }
                : undefined,
        [playlist],
    );

    /** Runs a write, and on a stale version refetches and says so. */
    const write = useCallback(
        async (run: () => Promise<unknown>, failure: string) => {
            try {
                await run();
            } catch (error) {
                if (isVersionConflict(error)) {
                    await reloadSharedPlaylist();
                    showNotice("Playlist changed, try again.");
                } else {
                    showNotice(failure);
                }
            }
        },
        [reloadSharedPlaylist, showNotice],
    );

    const entryFor = useCallback(
        (track: MusicItem): SharedPlaylistEntry | undefined => {
            const id = entryIdOf(track);
            return entries.find((entry) => entry.entry_id === id);
        },
        [entries],
    );

    const trackMenuActions = useMemo<MusicListTrackAction[]>(() => {
        if (!editable) return [];
        return [
            {
                id: "shared-reorder",
                label: "Reorder songs",
                icon: "reorder-three",
                onPress: () => router.push(reorderHref),
            },
            {
                id: "shared-remove",
                label: "Remove from playlist",
                icon: "remove-circle-outline",
                labelColor: "destructive",
                iconColor: "destructive",
                onPress: (track) => {
                    const entry = entryFor(track);
                    if (!entry) return;
                    void write(
                        () => writes.removeSong({ entry_id: entry.entry_id }),
                        "Couldn't remove that song.",
                    );
                },
            },
        ];
    }, [editable, entryFor, reorderHref, router, write, writes]);

    async function play() {
        if (tracks.length === 0) return;
        await setShuffleMode(ShuffleMode.Off);
        await playQueue({ tracks, source });
    }

    async function shuffle() {
        if (tracks.length === 0) return;
        await setShuffleMode(ShuffleMode.Songs);
        await playQueue({
            tracks,
            startIndex: Math.floor(Math.random() * tracks.length),
            source,
        });
    }

    async function saveCopy() {
        if (!playlist) return;
        try {
            await createPlaylist(playlist.name, songIds);
            showNotice("Saved a copy to Apple Music.");
        } catch {
            showNotice("Couldn't save a copy.");
        }
    }

    async function leaveOrDelete() {
        if (!account) return;
        try {
            if (isOwner) await writes.deletePlaylist();
            else await writes.removeMember({ user_id: account.id });
            setConfirmLeave(false);
            router.back();
        } catch {
            showNotice(isOwner ? "Couldn't delete it." : "Couldn't leave.");
        }
    }

    if (sharedPlaylistErr && !playlist) {
        const notMember =
            (sharedPlaylistErr as { status?: number })?.status === 404;
        return (
            <View className="flex-1 items-center justify-center gap-3 bg-background px-6">
                <View className="absolute left-4 top-14">
                    <FloatingBackButton size={HERO_BUTTON_SIZE} />
                </View>
                {notMember ? (
                    <>
                        <Text className="text-base font-semibold text-foreground">
                            This playlist is private.
                        </Text>
                        <GlassPill
                            icon="keypad-outline"
                            label="Enter code"
                            onPress={() => router.push("/join" as Href)}
                        />
                    </>
                ) : (
                    <ErrorNotice
                        error={sharedPlaylistErr}
                        onRetry={() => void reloadSharedPlaylist()}
                    />
                )}
            </View>
        );
    }

    const options: TrackCollectionOption[] = [
        {
            id: "shared-options",
            label: "Playlist options",
            icon: "ellipsis-horizontal",
            onPress: () => setOptionsOpen(true),
        },
    ];
    const members = playlist?.members ?? [];
    const owner = members.find((member) => member.role === "owner");

    return (
        <View className="flex-1">
            <TrackCollectionView
                title={playlist?.name ?? "Shared playlist"}
                tracks={tracks}
                isLoading={
                    sharedPlaylistLoading ||
                    (songInfoLoading &&
                        tracks.length === 0 &&
                        entries.length > 0)
                }
                anticipatedTrackCount={entries.length}
                subtitle={owner ? `by ${owner.username}` : undefined}
                summary={`${entries.length} song${entries.length === 1 ? "" : "s"}`}
                artworkUrls={tracks
                    .slice(0, 4)
                    .map(
                        (track) =>
                            track.artworkUrlLarge ?? track.artworkUrl ?? "",
                    )
                    .filter(Boolean)}
                respectTopSafeArea
                onPlay={play}
                onShuffle={shuffle}
                onTrackPressOverride={(track) => togglePlayback(track, source)}
                trackMenuActions={trackMenuActions}
                options={options}
                backControl={<FloatingBackButton size={HERO_BUTTON_SIZE} />}
                header={
                    playlist ? (
                        <View className="flex-row items-center justify-center gap-3 px-6 pb-3">
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`${members.length} members`}
                                onPress={() =>
                                    router.push(
                                        `/social/playlist/${playlistId}/members` as Href,
                                    )
                                }
                                className="flex-row items-center active:opacity-60"
                            >
                                {members.slice(0, MEMBER_STACK).map((m, i) => (
                                    <View
                                        key={m.user_id}
                                        className={i ? "-ml-2" : ""}
                                    >
                                        <Initials
                                            username={m.username}
                                            size={28}
                                        />
                                    </View>
                                ))}
                                {members.length > MEMBER_STACK ? (
                                    <Text className="ml-1 text-xs font-semibold text-muted-foreground">
                                        +{members.length - MEMBER_STACK}
                                    </Text>
                                ) : null}
                            </Pressable>
                            {isOwner ? (
                                <GlassPill
                                    size="sm"
                                    icon="person-add-outline"
                                    label="Invite"
                                    onPress={() => setInviteOpen(true)}
                                />
                            ) : null}
                            {editable ? (
                                <GlassPill
                                    size="sm"
                                    icon="add"
                                    label="Add songs"
                                    onPress={() => setAdding(true)}
                                />
                            ) : null}
                        </View>
                    ) : null
                }
            />

            {notice ? (
                <View
                    pointerEvents="none"
                    accessibilityRole="alert"
                    className="absolute bottom-32 left-5 right-5 rounded-2xl bg-foreground px-4 py-3"
                >
                    <Text className="text-center text-sm text-background">
                        {notice}
                    </Text>
                </View>
            ) : null}

            {optionsOpen && playlist ? (
                <ModalPopup
                    visible
                    onClose={() => setOptionsOpen(false)}
                    title={playlist.name}
                >
                    {isOwner ? (
                        <OptionRow
                            label="Invite with code"
                            onPress={() => {
                                setOptionsOpen(false);
                                setInviteOpen(true);
                            }}
                        />
                    ) : null}
                    <OptionRow
                        label="Members"
                        onPress={() => {
                            setOptionsOpen(false);
                            router.push(
                                `/social/playlist/${playlistId}/members` as Href,
                            );
                        }}
                    />
                    {editable ? (
                        <OptionRow
                            label="Reorder songs"
                            onPress={() => {
                                setOptionsOpen(false);
                                router.push(reorderHref);
                            }}
                        />
                    ) : null}
                    <OptionRow
                        label="Share to feed"
                        onPress={() => {
                            setOptionsOpen(false);
                            setSharing(true);
                        }}
                    />
                    <OptionRow
                        label="Save a copy to Apple Music"
                        onPress={() => {
                            setOptionsOpen(false);
                            void saveCopy();
                        }}
                    />
                    {isOwner ? (
                        <OptionRow
                            label="Rename"
                            onPress={() => {
                                setOptionsOpen(false);
                                setRenaming(true);
                            }}
                        />
                    ) : null}
                    <OptionRow
                        label={isOwner ? "Delete playlist" : "Leave playlist"}
                        destructive
                        onPress={() => {
                            setOptionsOpen(false);
                            setConfirmLeave(true);
                        }}
                    />
                </ModalPopup>
            ) : null}

            {inviteOpen && playlist ? (
                <InviteCodePopup
                    title={playlist.name}
                    withRole
                    createInvite={writes.createInvite}
                    onClose={() => setInviteOpen(false)}
                />
            ) : null}

            {adding ? (
                <SongSearchSheet
                    title="Add songs"
                    actionLabel="Add"
                    onClose={() => setAdding(false)}
                    onPick={async (song) => {
                        const id = song.catalogId ?? song.id;
                        await writes.addSongs({ song_ids: [id] });
                    }}
                />
            ) : null}

            {playlist ? (
                <CreatePostDialog
                    open={sharing}
                    onOpenChange={setSharing}
                    title="Share playlist"
                    lockedAttachment={
                        <SharedPlaylistPostCard
                            playlist={{
                                playlist_id: playlist.playlist_id,
                                name: playlist.name,
                                song_count: entries.length,
                                member_count: members.length,
                                cover_song_ids: songIds.slice(0, 4),
                            }}
                        />
                    }
                    onCreate={async (content) => {
                        await createPost({
                            content,
                            shared_playlist_id: playlist.playlist_id,
                        });
                        showNotice("Shared to your feed.");
                    }}
                />
            ) : null}

            {renaming && playlist ? (
                <RenamePopup
                    name={playlist.name}
                    onClose={() => setRenaming(false)}
                    onSave={(name) =>
                        write(
                            () =>
                                writes.updateDetails({
                                    name,
                                    expected_version: playlist.version,
                                }),
                            "Couldn't rename it.",
                        )
                    }
                />
            ) : null}

            <GlassConfirmDialog
                open={confirmLeave}
                title={
                    isOwner ? "Delete this playlist?" : "Leave this playlist?"
                }
                description={
                    isOwner
                        ? "It goes away for every member."
                        : "You can come back with a new code."
                }
                confirmLabel={isOwner ? "Delete" : "Leave"}
                pendingLabel={isOwner ? "Deleting..." : "Leaving..."}
                pending={writes.writing}
                onOpenChange={setConfirmLeave}
                onConfirm={() => void leaveOrDelete()}
            />
        </View>
    );
}

function OptionRow({
    label,
    destructive = false,
    onPress,
}: {
    label: string;
    destructive?: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            onPress={onPress}
            className="rounded-lg px-3 py-3 active:opacity-60"
        >
            <Text
                className={
                    destructive
                        ? "text-base text-destructive"
                        : "text-base text-foreground"
                }
            >
                {label}
            </Text>
        </Pressable>
    );
}

function RenamePopup({
    name,
    onClose,
    onSave,
}: {
    name: string;
    onClose: () => void;
    onSave: (name: string) => Promise<void>;
}) {
    const [value, setValue] = useState(name);
    const trimmed = value.trim();
    return (
        <ModalPopup
            visible
            keyboardAware
            onClose={onClose}
            title="Rename playlist"
        >
            <View className="gap-3 px-1 pb-1">
                <GlassInput
                    value={value}
                    onChangeText={setValue}
                    maxLength={100}
                    autoFocus
                />
                <GlassButton
                    disabled={!trimmed || trimmed === name}
                    onPress={() => {
                        onClose();
                        void onSave(trimmed);
                    }}
                >
                    <Text className="font-semibold text-foreground">Save</Text>
                </GlassButton>
            </View>
        </ModalPopup>
    );
}

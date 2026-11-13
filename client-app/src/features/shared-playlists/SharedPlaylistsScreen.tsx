import type { MusicItem } from "@apple-musickit";
import { useNavigation, type Href } from "expo-router";
import {
    useCallback,
    useLayoutEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { View } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassInput } from "@/components/ui/glass-input";
import { Text } from "@/components/ui/text";
import { LibraryList, LibraryListRow } from "@/features/library/library-list";
import { useLibraryListSearch } from "@/features/library/library-list-header";
import { concatUnique, mapInOrder } from "@/features/library/play-queue";
import { useSongInfo, useTrackLookup } from "@/lib/musickit-hooks";
import { useOpenScreen } from "@/lib/open-screen";
import { usePlayAll } from "@/lib/play-all";
import {
    fetchSharedPlaylistSongIds,
    useCreateSharedPlaylist,
    useSharedPlaylists,
    type SharedPlaylistSummary,
} from "@/lib/routes/shared-playlists";
import { isUsableArtworkUrl } from "@/lib/utils";

import { roleLabel } from "./roles";

/** Playlists whose songs are read at once when Play queues them. */
const PLAYLIST_READS_AT_ONCE = 3;
/** The most songs Play queues across every playlist. */
const MAX_QUEUED_SONGS = 500;
const NO_PLAYLISTS: SharedPlaylistSummary[] = [];

/** `/social/playlists`: the caller's shared playlists on their own screen. */
export function SharedPlaylistsScreen() {
    const navigation = useNavigation();
    useLayoutEffect(() => {
        navigation.setOptions({ title: "Playlists" });
    }, [navigation]);
    return <SharedPlaylistsList />;
}

/**
 * The caller's shared playlists, ones they own and ones they joined, on
 * `LibraryList`, the same list as Library > Queries. `header` goes above
 * everything, like the Library's switch between its own playlists and these.
 * Search filters by name on the phone. Play and Shuffle queue every playlist
 * on show, in order.
 */
export function SharedPlaylistsList({ header }: { header?: ReactNode }) {
    const openScreen = useOpenScreen();
    const search = useLibraryListSearch();
    const { sharedPlaylists, sharedPlaylistsLoading, sharedPlaylistsErr } =
        useSharedPlaylists();
    const [creating, setCreating] = useState(false);
    const shown = useMemo(() => {
        const all = sharedPlaylists ?? NO_PLAYLISTS;
        const term = search.term?.toLowerCase();
        return term
            ? all.filter((playlist) =>
                  playlist.name.toLowerCase().includes(term),
              )
            : all;
    }, [search.term, sharedPlaylists]);

    // one lookup for every cover, not one per row
    const coverIds = useMemo(
        () =>
            (sharedPlaylists ?? NO_PLAYLISTS).flatMap((p) => p.cover_song_ids),
        [sharedPlaylists],
    );
    const { songInfo } = useSongInfo(coverIds);
    const artworkById = useMemo(() => {
        const map = new Map<string, string>();
        for (const song of songInfo) {
            if (!isUsableArtworkUrl(song.artworkUrl)) continue;
            map.set(song.id, song.artworkUrl!);
            if (song.catalogId) map.set(song.catalogId, song.artworkUrl!);
        }
        return map;
    }, [songInfo]);

    const lookupTracks = useTrackLookup();
    const resolveQueue = useCallback(async (): Promise<MusicItem[]> => {
        const lists = await mapInOrder(
            shown,
            PLAYLIST_READS_AT_ONCE,
            (playlist) => fetchSharedPlaylistSongIds(playlist.playlist_id),
        );
        const songIds = concatUnique(lists, (id) => id).slice(
            0,
            MAX_QUEUED_SONGS,
        );
        const found = await lookupTracks(songIds);
        return concatUnique(
            [songIds.flatMap((songId) => found.get(songId) ?? [])],
            (track) => track.id,
        );
    }, [lookupTracks, shown]);
    const playAll = usePlayAll({ resolveQueue });

    return (
        <View className="flex-1">
            <LibraryList
                items={shown}
                keyOf={(playlist) => String(playlist.playlist_id)}
                renderItem={(playlist) => (
                    <PlaylistRow
                        playlist={playlist}
                        artworkUrls={playlist.cover_song_ids.flatMap(
                            (id) => artworkById.get(id) ?? [],
                        )}
                        onPress={() =>
                            openScreen(
                                `/shared-playlist/${playlist.playlist_id}` as Href,
                            )
                        }
                    />
                )}
                isLoading={sharedPlaylistsLoading && !sharedPlaylists}
                error={sharedPlaylistsErr}
                emptyLabel={
                    search.term
                        ? "No shared playlists match."
                        : "No shared playlists yet. Make one and invite friends, or join one with a code."
                }
                above={header}
                search={search}
                placeholder="Search Shared Playlists"
                create={{
                    label: "New playlist",
                    onPress: () => setCreating(true),
                }}
                actions={{
                    onPlay: playAll.play,
                    onShuffle: playAll.shuffle,
                    disabled: shown.length === 0,
                    pending: playAll.pending,
                }}
            />
            {creating ? (
                <NewPlaylistPopup
                    onClose={() => setCreating(false)}
                    onCreated={(id) => {
                        setCreating(false);
                        openScreen(`/shared-playlist/${id}` as Href);
                    }}
                />
            ) : null}
        </View>
    );
}

function PlaylistRow({
    playlist,
    artworkUrls,
    onPress,
}: {
    playlist: SharedPlaylistSummary;
    artworkUrls: string[];
    onPress: () => void;
}) {
    const songs = `${playlist.song_count} song${playlist.song_count === 1 ? "" : "s"}`;
    const people = `${playlist.member_count} member${playlist.member_count === 1 ? "" : "s"}`;
    return (
        <LibraryListRow
            title={playlist.name}
            subtitle={`${songs} · ${roleLabel(playlist.role)} · ${people}`}
            artworkUrls={artworkUrls}
            fallbackIcon="albums"
            accessibilityLabel={`${playlist.name}, ${songs}, ${roleLabel(playlist.role)}`}
            onPress={onPress}
        />
    );
}

function NewPlaylistPopup({
    onClose,
    onCreated,
}: {
    onClose: () => void;
    onCreated: (id: number) => void;
}) {
    const [name, setName] = useState("");
    const [failed, setFailed] = useState(false);
    const { createSharedPlaylist, createSharedPlaylistLoading } =
        useCreateSharedPlaylist();
    const trimmed = name.trim();

    async function create() {
        if (!trimmed || createSharedPlaylistLoading) return;
        setFailed(false);
        try {
            const { playlist_id } = await createSharedPlaylist({
                name: trimmed,
            });
            onCreated(playlist_id);
        } catch {
            setFailed(true);
        }
    }

    return (
        <ModalPopup
            visible
            keyboardAware
            onClose={onClose}
            title="New playlist"
        >
            <View className="gap-3 px-1 pb-1">
                <GlassInput
                    placeholder="Name"
                    value={name}
                    onChangeText={setName}
                    maxLength={100}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={() => void create()}
                />
                {failed ? (
                    <Text className="text-sm text-destructive">
                        Couldn&apos;t make the playlist. Try again.
                    </Text>
                ) : null}
                <GlassButton
                    disabled={!trimmed || createSharedPlaylistLoading}
                    onPress={() => void create()}
                >
                    <Text className="font-semibold text-foreground">
                        {createSharedPlaylistLoading ? "Creating..." : "Create"}
                    </Text>
                </GlassButton>
            </View>
        </ModalPopup>
    );
}

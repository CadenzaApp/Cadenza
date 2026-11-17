import { useNavigation, useRouter, type Href } from "expo-router";
import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";

import { NewPlaylistPopup } from "@/components/custom/new-playlist-popup";
import { LibraryList, LibraryListRow } from "@/features/library/library-list";
import { useLibraryListSearch } from "@/features/library/library-list-header";
import { usePlayLists } from "@/features/library/use-play-lists";
import { useSongInfo } from "@/lib/musickit-hooks";
import { useOpenScreen } from "@/lib/open-screen";
import { useRailActions } from "@/lib/use-rail-actions";
import {
    fetchSharedPlaylistSongIds,
    useCreateSharedPlaylist,
    useSharedPlaylists,
    type SharedPlaylistSummary,
} from "@/lib/routes/shared-playlists";
import { isUsableArtworkUrl } from "@/lib/utils";

import { roleLabel } from "./roles";

const NO_PLAYLISTS: SharedPlaylistSummary[] = [];
const readPlaylistSongIds = (playlist: SharedPlaylistSummary) =>
    fetchSharedPlaylistSongIds(playlist.playlist_id);
const songIdOfId = (songId: string) => songId;

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
    const { createSharedPlaylist } = useCreateSharedPlaylist();
    const router = useRouter();
    const railActions = useMemo(
        () => [
            {
                icon: "add" as const,
                accessibilityLabel: "New shared playlist",
                onPress: () => setCreating(true),
            },
            {
                icon: "keypad-outline" as const,
                accessibilityLabel: "Enter a code",
                onPress: () => router.push("/join" as Href),
            },
        ],
        [router],
    );
    useRailActions(railActions);
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

    const playAll = usePlayLists({
        items: shown,
        read: readPlaylistSongIds,
        songIdOf: songIdOfId,
    });

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
                actions={{
                    onPlay: playAll.play,
                    onShuffle: playAll.shuffle,
                    disabled: shown.length === 0,
                    pending: playAll.pending,
                }}
            />
            {creating ? (
                <NewPlaylistPopup
                    title="New shared playlist"
                    onClose={() => setCreating(false)}
                    create={async (name) => {
                        const { playlist_id } = await createSharedPlaylist({
                            name,
                        });
                        setCreating(false);
                        openScreen(`/shared-playlist/${playlist_id}` as Href);
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

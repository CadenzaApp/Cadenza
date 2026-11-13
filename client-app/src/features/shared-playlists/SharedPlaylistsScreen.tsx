import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation, useRouter, type Href } from "expo-router";
import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";

import { ArtworkMosaic } from "@/components/custom/artwork-mosaic";
import { ErrorNotice } from "@/components/custom/error-notice";
import { ModalPopup } from "@/components/custom/modal-popup";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassInput } from "@/components/ui/glass-input";
import { GlassPanel } from "@/components/ui/glass-panel";
import { GlassPill } from "@/components/ui/glass-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useSongInfo } from "@/lib/musickit-hooks";
import {
    useCreateSharedPlaylist,
    useSharedPlaylists,
    type SharedPlaylistSummary,
} from "@/lib/routes/shared-playlists";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { useAppTheme } from "@/lib/theme";
import { isUsableArtworkUrl } from "@/lib/utils";

import { roleLabel } from "./roles";

/** `/social/playlists`: the caller's shared playlists on their own screen. */
export function SharedPlaylistsScreen() {
    const navigation = useNavigation();
    useLayoutEffect(() => {
        navigation.setOptions({ title: "Playlists" });
    }, [navigation]);
    return <SharedPlaylistsList />;
}

/**
 * The caller's shared playlists, ones they own and ones they joined, as a
 * screen's scroller. New playlist and Enter code sit above the list. `header`
 * goes above everything, inside the scroller, like the Library's switch
 * between its own playlists and these.
 */
export function SharedPlaylistsList({ header }: { header?: ReactNode }) {
    const router = useRouter();
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll();
    const { colors } = useAppTheme();
    const { sharedPlaylists, sharedPlaylistsLoading, sharedPlaylistsErr } =
        useSharedPlaylists();
    const [creating, setCreating] = useState(false);

    // one lookup for every cover, not one per row
    const coverIds = useMemo(
        () => (sharedPlaylists ?? []).flatMap((p) => p.cover_song_ids),
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

    let body;
    if (sharedPlaylistsErr) {
        body = <ErrorNotice error={sharedPlaylistsErr} />;
    } else if (sharedPlaylistsLoading && !sharedPlaylists) {
        body = (
            <GlassPanel>
                {[0, 1, 2].map((i) => (
                    <View
                        key={i}
                        className="flex-row items-center gap-3 px-4 py-3"
                    >
                        <Skeleton className="h-14 w-14 rounded-xl" />
                        <View className="gap-2">
                            <Skeleton className="h-4 w-36 rounded" />
                            <Skeleton className="h-3 w-24 rounded" />
                        </View>
                    </View>
                ))}
            </GlassPanel>
        );
    } else if (!sharedPlaylists?.length) {
        body = (
            <View className="items-center gap-2 py-16">
                <Ionicons
                    name="albums-outline"
                    size={40}
                    color={colors.mutedForeground}
                />
                <Text className="text-base font-semibold text-foreground">
                    No shared playlists yet
                </Text>
                <Text className="text-center text-sm text-muted-foreground">
                    Make one and invite friends, or join one with a code.
                </Text>
                <View className="mt-3 flex-row gap-2">
                    <GlassPill
                        icon="add"
                        label="New playlist"
                        onPress={() => setCreating(true)}
                    />
                    <GlassPill
                        icon="keypad-outline"
                        label="Enter code"
                        onPress={() => router.push("/join" as Href)}
                    />
                </View>
            </View>
        );
    } else {
        body = (
            <View className="gap-3">
                <View className="flex-row gap-2">
                    <GlassPill
                        icon="add"
                        label="New playlist"
                        onPress={() => setCreating(true)}
                    />
                    <GlassPill
                        icon="keypad-outline"
                        label="Enter code"
                        onPress={() => router.push("/join" as Href)}
                    />
                </View>
                <GlassPanel>
                    {sharedPlaylists.map((playlist, index) => (
                        <View key={playlist.playlist_id}>
                            {index > 0 ? (
                                <View className="ml-[84px] h-px bg-border" />
                            ) : null}
                            <PlaylistRow
                                playlist={playlist}
                                artworkUrls={playlist.cover_song_ids
                                    .map((id) => artworkById.get(id))
                                    .filter((url): url is string =>
                                        Boolean(url),
                                    )}
                                onPress={() =>
                                    router.push(
                                        `/social/playlist/${playlist.playlist_id}` as Href,
                                    )
                                }
                            />
                        </View>
                    ))}
                </GlassPanel>
            </View>
        );
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
                        },
                        scroll.contentContainerStyle,
                    ]}
                    showsVerticalScrollIndicator={false}
                >
                    {header ? <View className="mb-3">{header}</View> : null}
                    {body}
                </Animated.ScrollView>
            </ScreenScrollMarker>
            {creating ? (
                <NewPlaylistPopup
                    onClose={() => setCreating(false)}
                    onCreated={(id) => {
                        setCreating(false);
                        router.push(`/social/playlist/${id}` as Href);
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
    const { colors } = useAppTheme();
    const songs = `${playlist.song_count} song${playlist.song_count === 1 ? "" : "s"}`;
    const people = `${playlist.member_count} member${playlist.member_count === 1 ? "" : "s"}`;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${playlist.name}, ${songs}, ${roleLabel(playlist.role)}`}
            onPress={onPress}
            className="flex-row items-center gap-3 px-4 py-3 active:opacity-60"
        >
            <ArtworkMosaic
                artworkUrls={artworkUrls}
                size={56}
                placeholderColor={colors.muted}
                className="rounded-xl"
            />
            <View className="min-w-0 flex-1 gap-0.5">
                <Text
                    className="text-base font-semibold text-foreground"
                    numberOfLines={1}
                >
                    {playlist.name}
                </Text>
                <Text
                    className="text-xs text-muted-foreground"
                    numberOfLines={1}
                >
                    {songs} · {roleLabel(playlist.role)} · {people}
                </Text>
            </View>
            <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.mutedForeground}
            />
        </Pressable>
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

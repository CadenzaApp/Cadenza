import { useRouter, type Href } from "expo-router";
import { useMemo } from "react";
import { Pressable, View } from "react-native";

import { ArtworkMosaic } from "@/components/custom/artwork-mosaic";
import { PeekCarousel } from "@/components/custom/peek-carousel";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useSongInfo } from "@/lib/musickit-hooks";
import { useOpenScreen } from "@/lib/open-screen";
import {
    useProfileQueries,
    type ProfileQuery,
} from "@/lib/routes/saved-queries";
import {
    useProfilePlaylists,
    type SharedPlaylistSummary,
} from "@/lib/routes/shared-playlists";
import { useAppTheme } from "@/lib/theme";

import { ShelfHeader } from "./ShelfHeader";

/** Playlists the shelf shows before See all. */
const PLAYLIST_SHELF_SIZE = 10;

/**
 * A profile's shared playlists, then the queries they shared, each a
 * carousel with two whole and the next peeking in. On your own profile each
 * has See all, the Library's section opened on the Social stack
 * (`/social/library/:kind`) so going back returns here, and an empty one says
 * how to fill it. On
 * someone else's, a hidden or empty one is left out.
 */
export function ProfileShelves({ userId }: { userId: string }) {
    return (
        <>
            <PlaylistsShelf userId={userId} />
            <QueriesShelf userId={userId} />
        </>
    );
}

function PlaylistsShelf({ userId }: { userId: string }) {
    const router = useRouter();
    const openScreen = useOpenScreen();
    const own = useAccount().account?.id === userId;
    const { profilePlaylists } = useProfilePlaylists(userId);
    const playlists = useMemo(
        () => (profilePlaylists ?? []).slice(0, PLAYLIST_SHELF_SIZE),
        [profilePlaylists],
    );
    // one lookup for every cover, not one per card
    const coverIds = useMemo(
        () => playlists.flatMap((playlist) => playlist.cover_song_ids),
        [playlists],
    );
    const { songInfo } = useSongInfo(coverIds.length > 0 ? coverIds : null);
    const artworkFor = (playlist: SharedPlaylistSummary) =>
        playlist.cover_song_ids.flatMap((id) => {
            const song = songInfo.find(
                (info) => info.id === id || info.catalogId === id,
            );
            return song?.artworkUrl ? [song.artworkUrl] : [];
        });

    if (!profilePlaylists || (!own && playlists.length === 0)) return null;

    return (
        <View className="gap-3">
            <ShelfHeader
                title="Shared playlists"
                onSeeAll={
                    own
                        ? () =>
                              router.push(
                                  "/social/library/playlist?view=shared" as Href,
                              )
                        : undefined
                }
            />
            {playlists.length > 0 ? (
                <PeekCarousel
                    items={playlists}
                    keyOf={(playlist) => String(playlist.playlist_id)}
                    renderItem={(playlist, width) => (
                        <ShelfCard
                            width={width}
                            title={playlist.name}
                            detail={plural(playlist.song_count, "song")}
                            artworkUrls={artworkFor(playlist)}
                            accessibilityLabel={`Open shared playlist ${playlist.name}`}
                            onPress={() =>
                                openScreen(
                                    `/social/playlist/${playlist.playlist_id}` as Href,
                                )
                            }
                        />
                    )}
                />
            ) : (
                <EmptyShelf text="Playlists you make or join with friends show here." />
            )}
        </View>
    );
}

function QueriesShelf({ userId }: { userId: string }) {
    const router = useRouter();
    const openScreen = useOpenScreen();
    const own = useAccount().account?.id === userId;
    const { profileQueries } = useProfileQueries(userId);

    if (!profileQueries || (!own && profileQueries.length === 0)) return null;

    // a saved query opens on its stored songs. your own reads its query and
    // settings off your list there; someone else's needs only the id
    const open = (query: ProfileQuery) =>
        openScreen({
            pathname: "/query-results",
            params: {
                name: query.name,
                saved: String(query.saved_query_id),
            },
        });

    return (
        <View className="gap-3">
            <ShelfHeader
                title="Shared queries"
                onSeeAll={
                    own
                        ? () =>
                              router.push(
                                  "/social/library/query?view=shared" as Href,
                              )
                        : undefined
                }
            />
            {profileQueries.length > 0 ? (
                <PeekCarousel
                    items={profileQueries}
                    keyOf={(query) => String(query.saved_query_id)}
                    renderItem={(query, width) => (
                        <ShelfCard
                            width={width}
                            title={query.name}
                            detail={plural(query.song_count, "song")}
                            artworkUrls={query.artwork_urls}
                            accessibilityLabel={`Open query ${query.name}`}
                            onPress={() => open(query)}
                        />
                    )}
                />
            ) : (
                <EmptyShelf text="Share a saved query from its ... menu to show it here." />
            )}
        </View>
    );
}

/** A square cover, a title, and a line under it. */
function ShelfCard({
    width,
    title,
    detail,
    artworkUrls,
    accessibilityLabel,
    onPress,
}: {
    width: number;
    title: string;
    detail: string;
    artworkUrls: readonly string[];
    accessibilityLabel: string;
    onPress: () => void;
}) {
    const { colors } = useAppTheme();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            onPress={onPress}
            className="gap-2 active:opacity-70"
        >
            <ArtworkMosaic
                artworkUrls={artworkUrls}
                size={width}
                placeholderColor={colors.muted}
            />
            <View>
                <Text
                    className="text-sm font-semibold text-foreground"
                    numberOfLines={1}
                >
                    {title}
                </Text>
                <Text
                    className="text-xs text-muted-foreground"
                    numberOfLines={1}
                >
                    {detail}
                </Text>
            </View>
        </Pressable>
    );
}

function EmptyShelf({ text }: { text: string }) {
    return <Text className="text-sm text-muted-foreground">{text}</Text>;
}

function plural(count: number, word: string) {
    return `${count} ${word}${count === 1 ? "" : "s"}`;
}

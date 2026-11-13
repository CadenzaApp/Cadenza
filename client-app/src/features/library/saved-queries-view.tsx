import Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem } from "@apple-musickit";
import { useTheme } from "expo-router/react-navigation";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { FlatList, Pressable, View } from "react-native";
import Animated from "react-native-reanimated";

import { ArtworkMosaic } from "@/components/custom/artwork-mosaic";
import { ErrorNotice } from "@/components/custom/error-notice";
import type { SegmentOption } from "@/components/ui/segmented-control";
import { MusicListItemSkeleton } from "@/components/custom/music-list/music-list-item";
import { GlassConfirmDialog } from "@/components/ui/glass-confirm-dialog";
import { Text } from "@/components/ui/text";
import { useTrackLookup } from "@/lib/musickit-hooks";
import { useOpenScreen } from "@/lib/open-screen";
import { usePlayAll } from "@/lib/play-all";
import { describeQuery } from "@/lib/query-json";
import {
    fetchSavedQuerySongs,
    useDeleteSavedQuery,
    useSavedQueries,
    type SavedQuery,
} from "@/lib/routes/saved-queries";
import { useActivityTags, useUserTags } from "@/lib/routes/tags";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { useAppTheme } from "@/lib/theme";

import { LibraryListHeader, useLibraryListSearch } from "./library-list-header";
import { useLibraryViewSwitch } from "./library-view-switch";
import { concatUnique, mapInOrder } from "./play-queue";

const SKELETON_ROW_COUNT = 6;
/** Saved queries whose songs are read at once when Play queues them. */
const QUERY_READS_AT_ONCE = 3;
/**
 * The most songs Play queues across every query. A query can hold a thousand
 * songs from outside the library, and each of those costs a lookup.
 */
const ROW_ARTWORK_SIZE = 56;
const MAX_QUEUED_SONGS = 500;
const NO_SAVED_QUERIES: SavedQuery[] = [];

type QueriesView = "all" | "shared";

const VIEWS: readonly SegmentOption<QueriesView>[] = [
    { value: "all", label: "Your queries" },
    { value: "shared", label: "Shared queries" },
];

/**
 * The Queries category: every query the user saved from a results screen,
 * favorites first, or with the switch at the top only the ones they shared on
 * their profile. A row opens the songs it holds, with the cover it was
 * saved with. Search filters by name, here on the phone, since the whole list
 * is one small read. Play and Shuffle queue the songs every query on show
 * holds, the user's own songs first.
 */
export function SavedQueriesView() {
    const search = useLibraryListSearch();
    const { view, viewSwitch } = useLibraryViewSwitch(VIEWS);
    const { savedQueries, savedQueriesLoading, savedQueriesErr } =
        useSavedQueries();
    const shown = useMemo(() => {
        const all = (savedQueries ?? NO_SAVED_QUERIES).filter(
            (saved) => view === "all" || saved.shared,
        );
        const term = search.term?.toLowerCase();
        return term
            ? all.filter((saved) => saved.name.toLowerCase().includes(term))
            : all;
    }, [savedQueries, search.term, view]);
    const tagNames = useTagNames();
    const [deleting, setDeleting] = useState<SavedQuery | null>(null);
    const {
        deleteSavedQuery,
        deleteSavedQueryLoading,
        deleteSavedQueryErr,
        resetDeleteSavedQuery,
    } = useDeleteSavedQuery();

    const lookupTracks = useTrackLookup();
    const resolveQueue = useCallback(async (): Promise<MusicItem[]> => {
        const matches = await mapInOrder(shown, QUERY_READS_AT_ONCE, (saved) =>
            fetchSavedQuerySongs(saved.saved_query_id),
        );
        // the user's own songs from every query, then the rest
        const songIds = concatUnique(
            [
                ...matches.map((songs) => songs.filter((song) => song.certain)),
                ...matches.map((songs) =>
                    songs.filter((song) => !song.certain),
                ),
            ],
            (song) => song.songId,
        )
            .slice(0, MAX_QUEUED_SONGS)
            .map((song) => song.songId);
        const found = await lookupTracks(songIds);
        return concatUnique(
            [songIds.flatMap((songId) => found.get(songId) ?? [])],
            (track) => track.id,
        );
    }, [lookupTracks, shown]);
    const playAll = usePlayAll({ resolveQueue });

    async function confirmDelete() {
        if (!deleting) return;
        try {
            await deleteSavedQuery({
                saved_query_id: deleting.saved_query_id,
            });
            setDeleting(null);
        } catch {
            // the dialog shows deleteSavedQueryErr
        }
    }

    return (
        <>
            {savedQueriesErr ? <ErrorNotice error={savedQueriesErr} /> : null}
            <View className="flex-1">
                <SavedQueryList
                    queries={shown}
                    isLoading={savedQueriesLoading}
                    describe={(saved) => describeQuery(saved.query, tagNames)}
                    onDelete={setDeleting}
                    emptyLabel={
                        search.term
                            ? "No saved queries match."
                            : view === "shared"
                              ? "No shared queries yet. Share one from its ... menu."
                              : "No saved queries yet. Save one from a query's results."
                    }
                    header={
                        <>
                            <View className="px-5 pb-2">{viewSwitch}</View>
                            <LibraryListHeader
                                search={search}
                                placeholder="Search Queries"
                                actions={{
                                    onPlay: playAll.play,
                                    onShuffle: playAll.shuffle,
                                    disabled: shown.length === 0,
                                    pending: playAll.pending,
                                }}
                            />
                        </>
                    }
                />
            </View>
            <GlassConfirmDialog
                open={deleting !== null}
                title="Delete Query?"
                description={
                    deleting
                        ? `"${deleting.name}" will be removed from your saved queries. Its songs and tags are not touched.`
                        : ""
                }
                confirmLabel="Delete Query"
                pendingLabel="Deleting..."
                pending={deleteSavedQueryLoading}
                error={
                    deleteSavedQueryErr
                        ? "Couldn't delete this query. Please try again."
                        : null
                }
                onOpenChange={(open) => {
                    if (open) return;
                    setDeleting(null);
                    resetDeleteSavedQuery();
                }}
                onConfirm={() => void confirmDelete()}
            />
        </>
    );
}

/** The user's tags and the activity tags, so a query reads as names. */
function useTagNames() {
    const { userTags } = useUserTags();
    const { activityTags } = useActivityTags();
    return useMemo(
        () => [...(userTags ?? []), ...(activityTags ?? [])],
        [activityTags, userTags],
    );
}

function SavedQueryList({
    queries,
    isLoading,
    describe,
    onDelete,
    emptyLabel,
    header,
}: {
    queries: SavedQuery[];
    isLoading: boolean;
    describe: (saved: SavedQuery) => string;
    onDelete: (saved: SavedQuery) => void;
    emptyLabel: string;
    header: ReactNode;
}) {
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll<FlatList<SavedQuery>>();

    return (
        <ScreenScrollMarker>
            <Animated.FlatList
                {...scroll}
                className="flex-1"
                data={queries}
                keyExtractor={(saved) => String(saved.saved_query_id)}
                renderItem={({ item }) => (
                    <SavedQueryRow
                        saved={item}
                        description={describe(item)}
                        onDelete={onDelete}
                    />
                )}
                contentContainerStyle={[
                    { paddingBottom: listBottomInset },
                    scroll.contentContainerStyle,
                ]}
                ListHeaderComponent={<>{header}</>}
                ListEmptyComponent={
                    isLoading ? (
                        <View>
                            {Array.from(
                                { length: SKELETON_ROW_COUNT },
                                (_, index) => (
                                    <MusicListItemSkeleton
                                        key={index}
                                        fullBleed
                                    />
                                ),
                            )}
                        </View>
                    ) : (
                        <Text className="px-6 py-10 text-center text-muted-foreground">
                            {emptyLabel}
                        </Text>
                    )
                }
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            />
        </ScreenScrollMarker>
    );
}

function SavedQueryRow({
    saved,
    description,
    onDelete,
}: {
    saved: SavedQuery;
    description: string;
    onDelete: (saved: SavedQuery) => void;
}) {
    const { colors } = useTheme();
    const { brand } = useAppTheme().colors;
    const openScreen = useOpenScreen();

    function open() {
        openScreen({
            pathname: "/query-results",
            params: {
                query: JSON.stringify(saved.query),
                suggested: saved.consider_default_tags ? "1" : "",
                library: saved.library_or_tagged ? "1" : "",
                name: saved.name,
                saved: String(saved.saved_query_id),
            },
        });
    }

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${saved.name}`}
            onPress={open}
            className="relative flex-row items-center px-6 py-3 active:opacity-80"
        >
            <View className="absolute bottom-0 left-6 right-6 border-b border-border" />
            <View className="mr-3">
                {saved.artwork_urls.length > 0 ? (
                    <ArtworkMosaic
                        artworkUrls={saved.artwork_urls}
                        size={ROW_ARTWORK_SIZE}
                        placeholderColor={colors.text}
                        className="rounded"
                    />
                ) : (
                    <View
                        className="items-center justify-center rounded bg-muted"
                        style={{
                            width: ROW_ARTWORK_SIZE,
                            height: ROW_ARTWORK_SIZE,
                        }}
                    >
                        <Ionicons name="funnel" size={22} color={colors.text} />
                    </View>
                )}
            </View>
            <View className="flex-1 overflow-hidden">
                <View className="flex-row items-center gap-1">
                    {saved.favorite ? (
                        <Ionicons
                            name="star"
                            size={14}
                            color={brand}
                            accessibilityLabel="Favorite"
                        />
                    ) : null}
                    <Text
                        className="shrink text-base font-bold leading-tight text-foreground"
                        numberOfLines={1}
                    >
                        {saved.name}
                    </Text>
                </View>
                <Text
                    className="mt-0.5 text-sm leading-tight text-muted-foreground"
                    numberOfLines={1}
                >
                    {description}
                </Text>
            </View>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${saved.name}`}
                onPress={() => onDelete(saved)}
                hitSlop={10}
                className="ml-2 p-1 active:opacity-60"
            >
                <Ionicons name="trash-outline" size={20} color={colors.text} />
            </Pressable>
        </Pressable>
    );
}

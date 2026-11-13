import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import type { SegmentOption } from "@/components/ui/segmented-control";
import { GlassConfirmDialog } from "@/components/ui/glass-confirm-dialog";
import { useOpenScreen } from "@/lib/open-screen";
import { describeQuery } from "@/lib/query-json";
import type { QueryResultSong } from "@/lib/routes/queries";
import {
    fetchSavedQuerySongs,
    useDeleteSavedQuery,
    useSavedQueries,
    type SavedQuery,
} from "@/lib/routes/saved-queries";
import { useActivityTags, useUserTags } from "@/lib/routes/tags";
import { useAppTheme } from "@/lib/theme";

import { LibraryList, LibraryListRow } from "./library-list";
import { useLibraryListSearch } from "./library-list-header";
import { useLibraryViewSwitch } from "./library-view-switch";
import { usePlayLists } from "./use-play-lists";

const NO_SAVED_QUERIES: SavedQuery[] = [];

const readQuerySongs = (saved: SavedQuery) =>
    fetchSavedQuerySongs(saved.saved_query_id);
const songIdOfMatch = (song: QueryResultSong) => song.songId;
/** The user's own songs from every query, then the rest. */
const ownSongsFirst = (lists: readonly (readonly QueryResultSong[])[]) => [
    ...lists.map((songs) => songs.filter((song) => song.certain)),
    ...lists.map((songs) => songs.filter((song) => !song.certain)),
];

type QueriesView = "all" | "shared";

const VIEWS: readonly SegmentOption<QueriesView>[] = [
    { value: "all", label: "Your queries" },
    { value: "shared", label: "Shared queries" },
];

/**
 * The Queries category: every query the user saved from a results screen,
 * favorites first, or with the switch at the top only the ones they shared on
 * their profile, where New query (to the Cadenza tab) sits under the search. A row opens the songs it holds, with the cover it was
 * saved with. Search filters by name, here on the phone, since the whole list
 * is one small read. Play and Shuffle queue the songs every query on show
 * holds, the user's own songs first.
 */
export function SavedQueriesView() {
    const router = useRouter();
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

    const playAll = usePlayLists({
        items: shown,
        read: readQuerySongs,
        songIdOf: songIdOfMatch,
        arrange: ownSongsFirst,
    });

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
            <View className="flex-1">
                <LibraryList
                    items={shown}
                    keyOf={(saved) => String(saved.saved_query_id)}
                    renderItem={(saved) => (
                        <SavedQueryRow
                            saved={saved}
                            description={describeQuery(saved.query, tagNames)}
                            onDelete={setDeleting}
                        />
                    )}
                    isLoading={savedQueriesLoading}
                    error={savedQueriesErr}
                    emptyLabel={
                        search.term
                            ? "No saved queries match."
                            : view === "shared"
                              ? "No shared queries yet. Share one from its ... menu."
                              : "No saved queries yet. Save one from a query's results."
                    }
                    above={viewSwitch}
                    search={search}
                    placeholder="Search Queries"
                    create={
                        view === "shared"
                            ? {
                                  label: "New query",
                                  onPress: () => router.navigate("/cadenza"),
                              }
                            : undefined
                    }
                    actions={{
                        onPlay: playAll.play,
                        onShuffle: playAll.shuffle,
                        disabled: shown.length === 0,
                        pending: playAll.pending,
                    }}
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
        <LibraryListRow
            title={saved.name}
            subtitle={description}
            artworkUrls={saved.artwork_urls}
            fallbackIcon="funnel"
            accessibilityLabel={`Open ${saved.name}`}
            onPress={open}
            badge={
                saved.favorite ? (
                    <Ionicons
                        name="star"
                        size={14}
                        color={brand}
                        accessibilityLabel="Favorite"
                    />
                ) : null
            }
            trailing={
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${saved.name}`}
                    onPress={() => onDelete(saved)}
                    hitSlop={10}
                    className="ml-2 p-1 active:opacity-60"
                >
                    <Ionicons
                        name="trash-outline"
                        size={20}
                        color={colors.text}
                    />
                </Pressable>
            }
        />
    );
}

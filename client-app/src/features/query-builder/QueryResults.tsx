import type { MusicItem } from "@apple-musickit";
import { useCallback, useState } from "react";
import { Alert, useWindowDimensions, View } from "react-native";

import type {
    MusicListArrangement,
    MusicListPagination,
    MusicListSections,
} from "@/components/custom/music-list";
import { TrackCollectionView } from "@/components/custom/track-collection-view";
import { QueryOptionsMenu } from "@/components/custom/options-menu/query-options-menu";
import { ModalPopup } from "@/components/custom/modal-popup";
import { FloatingBackButton } from "@/components/ui/floating-back-button";
import { GlassButton } from "@/components/ui/glass-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { useListeningEvents } from "@/lib/listening-events";
import { usePlayAll } from "@/lib/play-all";
import type { PlaySource } from "@/lib/play-source";
import { saveQueryErrorMessage } from "@/lib/routes/saved-queries";
import { usePlayFromList } from "@/lib/play-from-list";
import { usePlaybackTrackState } from "@/lib/playback";

import { matchCountLabel } from "./QueryUtils";

const HERO_BUTTON_SIZE = 52;

type Props = {
    /**
     * The tracks loaded so far, in order. More arrive through `pagination`, or
     * as `sections` open.
     */
    songs: MusicItem[];
    /** The cover mosaic, up to 4 urls. */
    artworkUrls: readonly string[];
    /** The page color behind the cover. */
    tint: string | null;
    isLoading: boolean;
    error?: unknown;
    /** Every song the query matched, loaded or not. */
    matchCount: number;
    /** More songs from outside the user's own matched than came back. */
    capped: boolean;
    /** The query matched only songs in the user's library or tagged by them. */
    libraryOrTagged: boolean;
    /** Null when grouped: each group loads its own songs. */
    pagination: MusicListPagination | null;
    /** The groups, when the results are grouped. */
    sections: MusicListSections | null;
    /** The backend sorts and groups, so a new choice is a new result. */
    arrangement: MusicListArrangement;
    /**
     * The tracks Play and Shuffle queue. Unsorted, every song that is
     * certainly the user's own, including ones the list has not reached, and
     * the others already loaded. Sorted or grouped, only what is loaded.
     */
    resolvePlayQueue: () => Promise<MusicItem[]>;
    mostRelevantTags?: readonly string[];
    /** The activity tags the query filters on, shown on every row. */
    activityTagIds?: readonly number[];
    /** What a play from here is credited to in the analytics rankings. */
    playSource?: PlaySource;
    /** What the "..." menu does. Without it there is no menu. */
    actions?: QueryResultsActions;
};

/** The query menu's writes. Each rejects with the backend's error. */
export type QueryResultsActions = {
    /** Null until the query is saved. */
    saved: { favorite: boolean } | null;
    /** Saves the query under a name, favorited or not. */
    save: (name: string, favorite: boolean) => Promise<void>;
    /** Only called once saved. */
    setFavorite: (favorite: boolean) => Promise<void>;
    /** Only called once saved. Replaces its songs with what it matches now. */
    rerun: () => Promise<void>;
};

export default function QueryResults({
    songs,
    artworkUrls,
    tint,
    isLoading,
    error,
    matchCount,
    capped,
    libraryOrTagged,
    pagination,
    sections,
    arrangement,
    resolvePlayQueue,
    mostRelevantTags,
    activityTagIds,
    playSource,
    actions,
}: Props) {
    const { width: screenWidth } = useWindowDimensions();
    const [menuOpen, setMenuOpen] = useState(false);
    const [saveOpen, setSaveOpen] = useState(false);
    // favorite on an unsaved query saves it first, favorited
    const [saveAsFavorite, setSaveAsFavorite] = useState(false);
    const [favoriteBusy, setFavoriteBusy] = useState(false);
    const [rerunning, setRerunning] = useState(false);
    const [saveName, setSaveName] = useState("");
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const { recordEvent } = useListeningEvents();
    const playFromList = usePlayFromList();
    const { activeTrackId, isPlaying } = usePlaybackTrackState();
    const saveDialogWidth = Math.round(screenWidth * 0.75);
    const allLoaded =
        !isLoading &&
        !pagination?.hasNextPage &&
        !pagination?.isLoadingNextPage &&
        matchCount > 0;
    const arranged =
        arrangement.value.sort !== null || arrangement.value.group !== null;

    /**
     * Notes that a song was played out of this query, which is what the query
     * play rate is built from. Only the song that starts playing is recorded,
     * so the rate counts starts. Every counted play in the queue is credited to
     * the query separately, through `playSource`, for the query ranking.
     */
    const recordQueryPlay = useCallback(
        (track: MusicItem) => {
            // the id tags cross the api under, the same key the rest of the app
            // reads a song's tags with
            const songId = track.catalogId ?? track.id;
            void recordEvent("query_play", songId, {
                result_count: matchCount,
            }).catch(() => {
                // a lost event is not worth interrupting playback over
            });
        },
        [matchCount, recordEvent],
    );

    const { play: playFromTop, shuffle: shuffleAll } = usePlayAll({
        resolveQueue: resolvePlayQueue,
        source: playSource,
        onStart: recordQueryPlay,
    });

    const playOneSong = useCallback(
        async (track: MusicItem) => {
            // the playing row pauses instead, so recording unconditionally
            // would count a pause as a play
            const isPausing = activeTrackId === track.id && isPlaying;
            if (!isPausing) recordQueryPlay(track);
            await playFromList(songs, track, playSource);
        },
        [
            activeTrackId,
            isPlaying,
            playFromList,
            playSource,
            recordQueryPlay,
            songs,
        ],
    );
    function openSaveDialog(favorite: boolean) {
        setSaveAsFavorite(favorite);
        setSaveOpen(true);
    }

    function closeSaveDialog() {
        setSaveOpen(false);
        setSaveName("");
        setSaveError(null);
    }

    async function toggleFavorite() {
        if (!actions || favoriteBusy) return;
        if (!actions.saved) {
            setMenuOpen(false);
            openSaveDialog(true);
            return;
        }
        setFavoriteBusy(true);
        try {
            await actions.setFavorite(!actions.saved.favorite);
        } catch (favoriteErr) {
            console.error("Unable to update the query favorite.", favoriteErr);
            Alert.alert("Couldn't Update Favorite", "Please try again.");
        } finally {
            setFavoriteBusy(false);
        }
    }

    async function rerun() {
        if (!actions?.saved || rerunning) return;
        setRerunning(true);
        try {
            await actions.rerun();
        } catch (rerunErr) {
            console.error("Unable to rerun the query.", rerunErr);
            Alert.alert("Couldn't Rerun Query", "Please try again.");
        } finally {
            setRerunning(false);
        }
    }

    async function submitSave() {
        const name = saveName.trim();
        if (!name || !actions || saving) return;
        setSaving(true);
        setSaveError(null);
        try {
            await actions.save(name, saveAsFavorite);
            closeSaveDialog();
        } catch (saveErr) {
            setSaveError(saveQueryErrorMessage(saveErr));
        } finally {
            setSaving(false);
        }
    }

    return (
        <View className="flex-1">
            <TrackCollectionView
                title="Matching Songs"
                tracks={songs}
                isLoading={isLoading}
                error={error}
                anticipatedTrackCount={matchCount}
                summary={
                    rerunning
                        ? "Rerunning..."
                        : matchCountLabel(matchCount, capped)
                }
                pagination={pagination}
                sections={sections}
                arrangement={arrangement}
                footer={
                    allLoaded ? (
                        <Text className="px-6 py-4 text-center text-sm text-muted-foreground">
                            {actions?.saved
                                ? "These are the songs saved with this query. Rerun it from the menu to pick up songs tagged since."
                                : capped && arranged
                                  ? "These are the first 1,000 matching songs in this order. Narrow the query to see more."
                                  : capped
                                    ? "These are your matching songs and the first 1,000 others Cadenza knows. Narrow the query to see more."
                                    : libraryOrTagged
                                      ? "These are all the songs in your library or tagged by you that match."
                                      : "These are all the songs Cadenza knows that match."}
                        </Text>
                    ) : null
                }
                respectTopSafeArea
                backControl={<FloatingBackButton size={HERO_BUTTON_SIZE} />}
                multiSelect={{}}
                showTags
                mostRelevantTags={mostRelevantTags}
                activityTagIds={activityTagIds}
                backgroundColor={tint}
                artworkUrls={artworkUrls}
                onPlay={playFromTop}
                onShuffle={shuffleAll}
                onTrackPressOverride={playOneSong}
                options={
                    actions
                        ? [
                              {
                                  id: "query-options",
                                  label: "More options",
                                  icon: "ellipsis-horizontal",
                                  onPress: () => setMenuOpen(true),
                              },
                          ]
                        : []
                }
            />

            {menuOpen && actions ? (
                <QueryOptionsMenu
                    saved={actions.saved !== null}
                    favorite={actions.saved?.favorite ?? false}
                    favoriteBusy={favoriteBusy}
                    resolveTracks={resolvePlayQueue}
                    onToggleFavorite={() => void toggleFavorite()}
                    onSave={() => openSaveDialog(false)}
                    onRerun={() => void rerun()}
                    onClose={() => setMenuOpen(false)}
                />
            ) : null}

            <ModalPopup
                visible={saveOpen}
                onClose={closeSaveDialog}
                title="Save Query"
                contentStyle={{
                    width: saveDialogWidth,
                    minWidth: saveDialogWidth,
                    maxWidth: saveDialogWidth,
                    transform: [{ translateY: -96 }],
                }}
            >
                <Text className="text-sm text-muted-foreground">
                    {saveAsFavorite
                        ? "Give this query a name to save it as a favorite."
                        : "Give this query a name."}
                </Text>
                <View className="gap-1.5">
                    <Label>Query name</Label>
                    <Input
                        value={saveName}
                        onChangeText={(name) => {
                            setSaveName(name);
                            setSaveError(null);
                        }}
                        placeholder="e.g. Late night favorites"
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={() => void submitSave()}
                    />
                    {saveError ? (
                        <Text className="text-sm text-destructive">
                            {saveError}
                        </Text>
                    ) : null}
                </View>
                <View className="mt-1 flex-row gap-2.5">
                    <View className="flex-1">
                        <GlassButton
                            className="w-full"
                            onPress={closeSaveDialog}
                        >
                            <Text>Cancel</Text>
                        </GlassButton>
                    </View>
                    <View className="flex-1">
                        <GlassButton
                            className="w-full"
                            disabled={!saveName.trim() || saving}
                            onPress={() => void submitSave()}
                        >
                            <Text>{saving ? "Saving..." : "Save"}</Text>
                        </GlassButton>
                    </View>
                </View>
            </ModalPopup>
        </View>
    );
}

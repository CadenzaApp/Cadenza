import {
    createContext,
    memo,
    useContext,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type Ref,
} from "react";
import type { MusicItem } from "@apple-musickit";
import { FlashList } from "@shopify/flash-list";
import {
    ScrollView,
    View,
    type ScrollViewProps,
    type ViewToken,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    Easing,
    FadeIn,
    runOnJS,
    useAnimatedStyle,
    useComposedEventHandler,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";

import { Text } from "@/components/ui/text";
import { SongOptionsMenu } from "@/components/custom/options-menu/song-options-menu";
import { usePlaybackCommands } from "@/lib/playback";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { useTopRailInset } from "@/lib/top-rail";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { useMusicListPreferences } from "@/lib/music-list-preferences";

import {
    MusicListItem,
    MusicListItemSkeleton,
    MUSIC_LIST_ITEM_HEIGHT,
    type MusicListItemProps,
} from "./music-list-item";
import { MusicListRowShimmer } from "./music-list-row-shimmer";
import {
    RowTagSource,
    useRowTags,
    useRowTagStore,
    type RowTagStore,
} from "./row-tags";
import { MusicListSortButton } from "./music-list-sort-button";
import { sortTracks } from "./sort-tracks";
import { useMusicListSelection } from "./use-music-list-selection";
import {
    DEFAULT_MUSIC_LIST_SORT_OPTIONS,
    type MusicListProps,
    type MusicListSort,
    type MusicListTrackAction,
} from "./types";

const DEFAULT_SORT: MusicListSort = {
    option: "title",
    direction: "ascending",
};
const EMPTY_TAG_NAMES: readonly string[] = [];
const EMPTY_TRACK_ACTIONS: readonly MusicListTrackAction[] = [];
const MAX_INITIAL_SKELETON_ROWS = 10;
const EMPTY_ACTIVITY_TAG_IDS: readonly number[] = [];
// Masked tag rails are substantially more expensive to move than a plain row.
// Keep the transition for light lists and snap directly into selection mode
// once the visible content would require too many simultaneous composites.
const MAX_ANIMATED_SELECTION_COST = 80;
const TAG_SELECTION_ANIMATION_COST = 2;
const DENSITY_FADE_OUT_MS = 140;
const DENSITY_ROW_FADE_IN_MS = 220;
const DENSITY_ROW_STAGGER_MS = 32;
const DENSITY_MAX_STAGGER_MS = 560;
const MUSIC_LIST_BOTTOM_SPACER_ROWS = 2;
/**
 * Renders only the rows on screen plus a short way past them, and reuses row
 * slots as the list scrolls. A FlatList kept rendering rows off screen in
 * batches after a page landed, each one a JS stall. Wrapped by Reanimated so
 * the screen's worklet scroll handler attaches to it like any scroller.
 */
const AnimatedFlashList = Animated.createAnimatedComponent(
    FlashList<MusicItem>,
);

const NO_CONTENT_POSITION = { disabled: true } as const;

/**
 * FlashList's scroller, inside the screen's scroll marker. FlashList wraps its
 * ScrollView in a container view, and the marker needs the ScrollView itself
 * as its only child to register it with the native stack and tabs (the iOS
 * marker asserts on anything else). Supplying the scroller puts the marker
 * between FlashList's container and the ScrollView, where it can find it.
 */
function MarkedScrollView({
    ref,
    children,
    ...props
}: ScrollViewProps & { ref?: Ref<ScrollView> }) {
    const background = useContext(ContentBackgroundContext);
    return (
        <ScreenScrollMarker>
            <ScrollView ref={ref} {...props}>
                {background ? (
                    <View pointerEvents="none" style={CONTENT_FILL}>
                        {background}
                    </View>
                ) : null}
                {children}
            </ScrollView>
        </ScreenScrollMarker>
    );
}

/**
 * The list's `contentBackground`, read by the scroller. A context rather than
 * a closure, so the scroll component FlashList is given never changes and the
 * ScrollView is never remounted.
 */
const ContentBackgroundContext = createContext<ReactNode>(null);
const CONTENT_FILL = {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
} as const;
// mostly on screen and held there, so a row flung past does not use it up
const HIGHLIGHT_VIEWABILITY = {
    itemVisiblePercentThreshold: 80,
    minimumViewTime: 250,
};

type HighlightPhase = "waiting" | "playing" | "done";

export function MusicList({
    tracks,
    isLoading,
    highlightTrackId,
    onTrackPressOverride = null,
    renderAccessory = null,
    trackMenuActions = EMPTY_TRACK_ACTIONS,
    multiSelect = null,
    fullBleedRows = false,
    fullBleedRowHorizontalPadding = 18,
    rowSurfaceColor = "background",
    embedded = false,
    compact,
    onCompactChange,
    showTags = true,
    mostRelevantTags = EMPTY_TAG_NAMES,
    activityTagIds = EMPTY_ACTIVITY_TAG_IDS,
    anticipatedTrackCount = 8,
    header: headerProp,
    listHeader,
    footer,
    onContentSizeChange,
    contentBackground,
    removeClippedSubviews,
    onScroll,
    pagination,
    sorting,
}: MusicListProps) {
    const header = headerProp ?? listHeader;
    const { togglePlayback } = usePlaybackCommands();
    const { showSuggestedTags } = useMusicListPreferences();
    const [internalCompact, setInternalCompact] = useState(false);
    const isCompact = compact ?? internalCompact;
    const [densityTransitionRevision, setDensityTransitionRevision] =
        useState(0);
    const [densityTransitioning, setDensityTransitioning] = useState(false);
    const [densityRevealActive, setDensityRevealActive] = useState(false);
    const [internalSort, setInternalSort] = useState(
        sorting?.defaultValue ?? DEFAULT_SORT,
    );
    const [menuTrack, setMenuTrack] = useState<(typeof tracks)[number] | null>(
        null,
    );
    const [selectionToolbarHeight, setSelectionToolbarHeight] = useState(120);
    const controlledSort = sorting?.value;
    const onSortChange = sorting?.onChange;
    const sort = controlledSort ?? internalSort;
    const sortOptions = sorting?.options ?? DEFAULT_MUSIC_LIST_SORT_OPTIONS;
    const sortStrategy = sorting?.strategy ?? "local";
    const sortingEnabled = sorting != null && sortOptions.length > 0;
    const hasNextPage = pagination?.hasNextPage ?? false;
    const isLoadingNextPage = pagination?.isLoadingNextPage ?? false;
    const onLoadNextPage = pagination?.onLoadNextPage;
    const isLoadingMoreRef = useRef(false);
    const scroll = useScreenScroll<typeof AnimatedFlashList>();
    // the skeleton is not in the scroller, so the scroller's inset misses it
    const railInset = useTopRailInset();
    const composedOnScroll = useComposedEventHandler([
        scroll.onScroll,
        onScroll ?? null,
    ]);
    const [revealTrackIds, setRevealTrackIds] = useState<ReadonlySet<string>>(
        new Set(),
    );
    const listOpacity = useSharedValue(1);
    const listTransitionStyle = useAnimatedStyle(() => ({
        opacity: listOpacity.get(),
    }));
    const { floatingActionBottom, listBottomInset, playerBottomInset } =
        useScreenOverlayInsets();
    const displayedTracks = useMemo(
        () =>
            sortingEnabled && sortStrategy === "local"
                ? sortTracks(tracks, sort)
                : tracks,
        [sortStrategy, sortingEnabled, sort, tracks],
    );
    const selection = useMusicListSelection(displayedTracks, multiSelect);
    const { isSelecting, toggleSelection } = selection;
    const selectionCanApplyTags =
        multiSelect != null &&
        (multiSelect.actions == null ||
            multiSelect.actions.some((action) => action.kind === "apply-tags"));
    const localTagsEnabled = showTags || selection.isSelecting;
    const showSuggestedTagsInRows = showTags && showSuggestedTags;
    const defaultTagsEnabled =
        showSuggestedTagsInRows ||
        (selection.isSelecting &&
            selection.selectedTracks.length === 1 &&
            selectionCanApplyTags);
    const tagsEnabled =
        localTagsEnabled || defaultTagsEnabled || activityTagIds.length > 0;
    const taggableIds = useMemo(
        () =>
            tagsEnabled
                ? tracks.map((track) => track.catalogId ?? track.id)
                : [],
        [tagsEnabled, tracks],
    );
    // the tag reads live in RowTagSource and rows read their own song from
    // this store, so a tag response never re-renders the list
    const rowTagStore = useRowTagStore();
    // read from the store without subscribing: it only matters at the moment
    // selection toggles, which renders the list anyway
    const { tagsBySong, defaultTagsBySong } = rowTagStore.snapshot();
    let selectionAnimationCost = displayedTracks.length;
    if (showTags) {
        for (const track of displayedTracks) {
            const songId = track.catalogId ?? track.id;
            selectionAnimationCost +=
                TAG_SELECTION_ANIMATION_COST *
                ((tagsBySong[songId]?.length ?? 0) +
                    (defaultTagsBySong[songId]?.length ?? 0));
            if (selectionAnimationCost > MAX_ANIMATED_SELECTION_COST) break;
        }
    }
    const animateSelectionTransition =
        selectionAnimationCost <= MAX_ANIMATED_SELECTION_COST;
    const selectionToolbarBottom = floatingActionBottom;
    const bottomRowSpacer =
        MUSIC_LIST_ITEM_HEIGHT[isCompact ? "compact" : "regular"] *
        MUSIC_LIST_BOTTOM_SPACER_ROWS;
    const bottomOverlayInset = embedded
        ? 0
        : selection.isSelecting
          ? selectionToolbarBottom + selectionToolbarHeight + 12
          : sortingEnabled
            ? listBottomInset
            : Math.max(40, playerBottomInset + 12);
    const contentBottomInset = bottomOverlayInset + bottomRowSpacer;
    // the highlighted row plays once it is really on screen, which may be
    // after a scroll, and once it has played it is done for good
    const [highlightPhase, setHighlightPhase] = useState<HighlightPhase>(
        highlightTrackId ? "waiting" : "done",
    );
    const isHighlighted = useCallback(
        (track: (typeof tracks)[number]) =>
            highlightTrackId != null &&
            [track.id, track.catalogId, track.libraryId].includes(
                highlightTrackId,
            ),
        [highlightTrackId],
    );
    // FlatList errors if this changes after mount. it only follows the
    // highlight, which is fixed for a screen
    const onViewableItemsChanged = useCallback(
        ({ viewableItems }: { viewableItems: ViewToken[] }) => {
            const seen = viewableItems.some(
                (token) =>
                    token.isViewable &&
                    isHighlighted(token.item as (typeof tracks)[number]),
            );
            if (!seen) return;
            setHighlightPhase((phase) =>
                phase === "waiting" ? "playing" : phase,
            );
        },
        [isHighlighted],
    );
    const finishHighlight = useCallback(() => setHighlightPhase("done"), []);
    const listExtraData = useMemo(
        () => ({
            isCompact,
            densityTransitionRevision,
            densityRevealActive,
            selectedIds: selection.selectedIds,
            highlightPhase,
        }),
        [
            densityRevealActive,
            highlightPhase,
            densityTransitionRevision,
            isCompact,
            selection.selectedIds,
        ],
    );

    const commitDensityTransition = useCallback(
        (nextCompact: boolean) => {
            if (compact === undefined) setInternalCompact(nextCompact);
            onCompactChange?.(nextCompact);
            setDensityTransitionRevision((revision) => revision + 1);
            setDensityRevealActive(true);
        },
        [compact, onCompactChange],
    );
    const abortDensityTransition = useCallback(() => {
        listOpacity.set(1);
        setDensityTransitioning(false);
        setRevealTrackIds(new Set());
    }, [listOpacity]);
    const beginDensityTransition = useCallback(
        (nextCompact: boolean) => {
            if (nextCompact === isCompact || densityTransitioning) {
                return;
            }
            setRevealTrackIds(
                new Set(displayedTracks.map((track) => track.id)),
            );
            setDensityTransitioning(true);
            listOpacity.set(
                withTiming(
                    0,
                    {
                        duration: DENSITY_FADE_OUT_MS,
                        easing: Easing.out(Easing.quad),
                    },
                    (finished) => {
                        if (finished) {
                            runOnJS(commitDensityTransition)(nextCompact);
                        } else {
                            // Backgrounding the app cancels the fade. Without
                            // this the revision never bumps, the cleanup effect
                            // never runs, and the list stays dimmed with the
                            // pinch guard latched on.
                            runOnJS(abortDensityTransition)();
                        }
                    },
                ),
            );
        },
        [
            abortDensityTransition,
            commitDensityTransition,
            densityTransitioning,
            displayedTracks,
            isCompact,
            listOpacity,
        ],
    );
    // Rebuilding this every render hands GestureDetector a new gesture ~1.3
    // times a second, which can swap the handler out mid-pinch.
    const pinchGesture = useMemo(
        () =>
            Gesture.Pinch().onEnd((event) => {
                if (event.scale <= 0.92) runOnJS(beginDensityTransition)(true);
                else if (event.scale >= 1.08)
                    runOnJS(beginDensityTransition)(false);
            }),
        [beginDensityTransition],
    );

    useEffect(() => {
        if (densityTransitionRevision === 0) return;
        scroll.ref.current?.scrollToOffset({ offset: 0, animated: false });
        listOpacity.set(1);
        const revealWindow = setTimeout(() => {
            setDensityRevealActive(false);
            setDensityTransitioning(false);
            setRevealTrackIds(new Set());
        }, DENSITY_MAX_STAGGER_MS + DENSITY_ROW_FADE_IN_MS);
        return () => clearTimeout(revealWindow);
    }, [densityTransitionRevision, listOpacity, scroll.ref]);

    function densityFadeDelay(index: number) {
        return Math.min(
            (index % 18) * DENSITY_ROW_STAGGER_MS,
            DENSITY_MAX_STAGGER_MS,
        );
    }

    const handleSortChange = useCallback(
        (nextSort: MusicListSort) => {
            if (!controlledSort) setInternalSort(nextSort);
            onSortChange?.(nextSort);
        },
        [controlledSort, onSortChange],
    );

    const handleEndReached = useCallback(async () => {
        if (
            !hasNextPage ||
            isLoadingNextPage ||
            !onLoadNextPage ||
            isLoadingMoreRef.current
        ) {
            return;
        }

        isLoadingMoreRef.current = true;
        try {
            await onLoadNextPage();
        } finally {
            isLoadingMoreRef.current = false;
        }
    }, [hasNextPage, isLoadingNextPage, onLoadNextPage]);

    const handleTrackPress = useCallback(
        (track: (typeof tracks)[number]) => {
            if (isSelecting) {
                toggleSelection(track);
                return;
            }

            if (onTrackPressOverride) {
                void Promise.resolve(onTrackPressOverride(track)).catch(
                    (error) => {
                        console.error("Music list track press failed:", error);
                    },
                );
                return;
            }

            void togglePlayback(track);
        },
        [isSelecting, onTrackPressOverride, togglePlayback, toggleSelection],
    );
    const closeTrackMenu = useCallback(() => setMenuTrack(null), []);

    return (
        <View style={{ flex: 1, position: "relative" }}>
            <GestureDetector gesture={pinchGesture}>
                <Animated.View className="flex-1" style={listTransitionStyle}>
                    {isLoading && tracks.length === 0 ? (
                        <View
                            className={fullBleedRows ? undefined : "px-6"}
                            style={{
                                paddingTop: railInset ?? undefined,
                                paddingBottom: contentBottomInset,
                            }}
                        >
                            {header}
                            {Array.from({
                                length: Math.min(
                                    anticipatedTrackCount,
                                    MAX_INITIAL_SKELETON_ROWS,
                                ),
                            }).map((_, index) => (
                                <View key={index}>
                                    <MusicListItemSkeleton
                                        fullBleed={fullBleedRows}
                                        fullBleedHorizontalPadding={
                                            fullBleedRowHorizontalPadding
                                        }
                                        compact={isCompact}
                                    />
                                </View>
                            ))}
                            {footer}
                        </View>
                    ) : (
                        <ContentBackgroundContext.Provider
                            value={contentBackground}
                        >
                            <AnimatedFlashList
                                {...scroll}
                                style={[{ flex: 1 }, scroll.style]}
                                renderScrollComponent={MarkedScrollView}
                                // for chat views that prepend; a song list only
                                // grows at the end, and the offset nudges fought
                                // the pull to close
                                maintainVisibleContentPosition={
                                    NO_CONTENT_POSITION
                                }
                                // Overscrolling at the top is how a detail screen
                                // closes, and an indicator flicking in over the
                                // shrinking card is noise.
                                showsVerticalScrollIndicator={false}
                                data={displayedTracks}
                                extraData={listExtraData}
                                keyExtractor={(item) => item.id}
                                renderItem={({ item, index }) => (
                                    <Animated.View
                                        // only the density change remounts rows, for
                                        // their fade in. keyed by song too, a row slot
                                        // FlashList moved to another song was thrown
                                        // away and rebuilt rather than reused
                                        key={densityTransitionRevision}
                                        entering={
                                            densityRevealActive &&
                                            revealTrackIds.has(item.id)
                                                ? FadeIn.delay(
                                                      densityFadeDelay(index),
                                                  ).duration(
                                                      DENSITY_ROW_FADE_IN_MS,
                                                  )
                                                : undefined
                                        }
                                    >
                                        <MusicListRow
                                            store={rowTagStore}
                                            songId={item.catalogId ?? item.id}
                                            item={item}
                                            selected={selection.selectedIds.has(
                                                item.id,
                                            )}
                                            selectionMode={
                                                selection.isSelecting
                                            }
                                            multiSelectEnabled={
                                                selection.enabled
                                            }
                                            animateSelectionTransition={
                                                animateSelectionTransition
                                            }
                                            fullBleed={fullBleedRows}
                                            fullBleedHorizontalPadding={
                                                fullBleedRowHorizontalPadding
                                            }
                                            rowSurfaceColor={rowSurfaceColor}
                                            compact={isCompact}
                                            mostRelevantTags={mostRelevantTags}
                                            activityTagIds={activityTagIds}
                                            accessory={renderAccessory?.(item)}
                                            onPress={handleTrackPress}
                                            onLongPress={
                                                selection.beginSelection
                                            }
                                            onOpenMenu={setMenuTrack}
                                        />
                                        {highlightPhase === "playing" &&
                                        isHighlighted(item) ? (
                                            <MusicListRowShimmer
                                                onDone={finishHighlight}
                                            />
                                        ) : null}
                                    </Animated.View>
                                )}
                                contentContainerStyle={[
                                    {
                                        paddingBottom: contentBottomInset,
                                        paddingHorizontal: fullBleedRows
                                            ? 0
                                            : 24,
                                    },
                                    scroll.contentContainerStyle,
                                ]}
                                ListHeaderComponent={
                                    header ? <>{header}</> : null
                                }
                                ListEmptyComponent={
                                    !isLoading ? (
                                        <Text className="text-muted-foreground text-center mt-10">
                                            Search for Artists, Songs, Lyrics,
                                            and More.
                                        </Text>
                                    ) : null
                                }
                                ListFooterComponent={
                                    <>
                                        {isLoadingNextPage ? (
                                            <MusicListLoadingSkeletons
                                                fullBleed={fullBleedRows}
                                                fullBleedHorizontalPadding={
                                                    fullBleedRowHorizontalPadding
                                                }
                                                compact={isCompact}
                                            />
                                        ) : null}
                                        {footer}
                                    </>
                                }
                                onContentSizeChange={onContentSizeChange}
                                removeClippedSubviews={removeClippedSubviews}
                                onScroll={composedOnScroll}
                                onEndReached={handleEndReached}
                                onEndReachedThreshold={0.1}
                                viewabilityConfig={HIGHLIGHT_VIEWABILITY}
                                onViewableItemsChanged={onViewableItemsChanged}
                            />
                        </ContentBackgroundContext.Provider>
                    )}
                </Animated.View>
            </GestureDetector>

            {sortingEnabled && !selection.isSelecting && (
                <MusicListSortButton
                    sort={sort}
                    options={sortOptions}
                    onSortChange={handleSortChange}
                />
            )}

            <RowTagSource
                store={rowTagStore}
                songIds={taggableIds}
                loadTags={localTagsEnabled}
                loadSuggested={defaultTagsEnabled}
                showTags={showTags}
                showSuggested={showSuggestedTagsInRows}
                activityTagIds={activityTagIds}
                toolbar={
                    selection.isSelecting && multiSelect
                        ? {
                              tracks: selection.selectedTracks,
                              config: multiSelect,
                              bottom: selectionToolbarBottom,
                              onClear: selection.clearSelection,
                              onHeightChange: setSelectionToolbarHeight,
                          }
                        : null
                }
            />

            <SongOptionsMenu
                track={menuTrack}
                onClose={closeTrackMenu}
                extraActions={trackMenuActions}
            />
        </View>
    );
}

function MusicListLoadingSkeletons({
    fullBleed,
    fullBleedHorizontalPadding,
    compact,
}: {
    fullBleed: boolean;
    fullBleedHorizontalPadding: number;
    compact: boolean;
}) {
    return (
        <View>
            {Array.from({ length: 5 }).map((_, index) => (
                <View key={index}>
                    <MusicListItemSkeleton
                        fullBleed={fullBleed}
                        fullBleedHorizontalPadding={fullBleedHorizontalPadding}
                        compact={compact}
                    />
                </View>
            ))}
        </View>
    );
}

export type {
    MusicListAction,
    MusicListActionIcon,
    MusicListMultiSelectConfig,
    MusicListPagination,
    MusicListProps,
    MusicListSelectionAction,
    MusicListSort,
    MusicListSortDirection,
    MusicListSortOption,
    MusicListSorting,
    MusicListTrackAction,
} from "./types";
export {
    DEFAULT_MUSIC_LIST_SORT_OPTIONS,
    MUSIC_LIST_SORT_OPTIONS,
} from "./types";

/** A row reading its own tags from the list's store, so only it re-renders. */
const MusicListRow = memo(function MusicListRow({
    store,
    songId,
    ...props
}: Omit<
    MusicListItemProps,
    "tags" | "defaultTags" | "activityTags" | "tagMetadata"
> & {
    store: RowTagStore;
    songId: string;
}) {
    const rowTags = useRowTags(store, songId);
    return <MusicListItem {...props} {...rowTags} />;
});

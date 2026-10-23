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

import {
    ContrastRegion,
    useSurfacePalette,
} from "@/lib/surface-contrast-context";
import { Text } from "@/components/ui/text";
import { SongOptionsMenu } from "@/components/custom/options-menu/song-options-menu";
import { usePlaybackCommands } from "@/lib/playback";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { useMusicListPreferences } from "@/lib/music-list-preferences";
import { sortLeadTag, type SortLeadTag } from "@/lib/sort-lead-tag";
import { useHideExplicit, useVisibleItems } from "@/lib/use-visible-items";

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
import { MusicListArrangeButton } from "./music-list-arrange-sheet";
import {
    GROUP_WINDOW,
    groupsToGrow,
    sectionRows,
    tagIdsToRead,
    type MusicListRowItem,
} from "./list-windows";
import {
    MUSIC_LIST_SECTION_HEADER_HEIGHT,
    MusicListSectionHeader,
} from "./music-list-section-header";
import type { RailLead } from "./sort-tags";
import { useMusicListSelection } from "./use-music-list-selection";
import type { MusicListProps, MusicListTrackAction } from "./types";

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
    FlashList<MusicListRowItem>,
);

/** How tall a row is, for where it sits on a tinted page's gradient. */
function rowHeightOf(row: MusicListRowItem, trackRowHeight: number) {
    switch (row.type) {
        case "header":
            return MUSIC_LIST_SECTION_HEADER_HEIGHT;
        default:
            return trackRowHeight;
    }
}

function rowKey(row: MusicListRowItem) {
    if (row.type !== "track") return `${row.type}:${row.section.key}`;
    return row.sectionKey ? `${row.sectionKey}:${row.track.id}` : row.track.id;
}

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

// any part on screen, reported as soon as it is, for the group windows and
// the tag reads
const WINDOW_VIEWABILITY = {
    itemVisiblePercentThreshold: 1,
    minimumViewTime: 0,
};
/** Rows whose tags are read before the list says what is on screen. */
const INITIAL_TAG_ROWS = 30;
const NO_GROUP_LIMITS: ReadonlyMap<string, number> = new Map();
const NO_SONG_IDS: readonly string[] = [];
const NO_READ_TAG_IDS: {
    ids: readonly string[];
    set: ReadonlySet<string>;
} = { ids: [], set: new Set() };

function songIdOf(track: MusicItem) {
    return track.catalogId ?? track.id;
}

type HighlightPhase = "waiting" | "playing" | "done";

export function MusicList({
    tracks: givenTracks,
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
    emptyContent,
    onContentSizeChange,
    contentBackground,
    removeClippedSubviews,
    onScroll,
    pagination: paginationProp,
    arrangement = null,
    sections = null,
}: MusicListProps) {
    const header = headerProp ?? listHeader;
    const tracks = useVisibleItems(givenTracks);
    const tinted = useSurfacePalette() != null;
    const [headerHeight, setHeaderHeight] = useState(0);
    const { togglePlayback } = usePlaybackCommands();
    const { showSuggestedTags } = useMusicListPreferences();
    const [internalCompact, setInternalCompact] = useState(false);
    const isCompact = compact ?? internalCompact;
    const rowHeight = MUSIC_LIST_ITEM_HEIGHT[isCompact ? "compact" : "regular"];
    const [densityTransitionRevision, setDensityTransitionRevision] =
        useState(0);
    const [densityTransitioning, setDensityTransitioning] = useState(false);
    const [densityRevealActive, setDensityRevealActive] = useState(false);
    const [menuTrack, setMenuTrack] = useState<(typeof tracks)[number] | null>(
        null,
    );
    const [selectionToolbarHeight, setSelectionToolbarHeight] = useState(120);
    // a grouped list loads each group on its own
    const pagination = sections ? null : paginationProp;
    const arrangementEnabled = arrangement != null;
    // a sorted list leads every row's tags with the tag it is sorted by
    const sortChoice = arrangement?.value.sort ?? null;
    const sortValues = arrangement?.sortValues;
    const lead = useMemo(
        () => sortLeadTag(sortChoice, sortValues),
        [sortChoice, sortValues],
    );
    const leadTagSource = lead?.kind === "tag" ? lead.source : null;
    const leadTagId = lead?.kind === "tag" ? lead.tagId : null;
    // an activity tag lead is read like any activity tag the list shows, first
    const shownActivityTagIds = useMemo(
        () =>
            leadTagSource === "activity" && leadTagId !== null
                ? [
                      leadTagId,
                      ...activityTagIds.filter((id) => id !== leadTagId),
                  ]
                : activityTagIds,
        [activityTagIds, leadTagId, leadTagSource],
    );
    // the user's own or a suggested tag lead is read and shown even with its
    // kind turned off
    const rowTagLead = useMemo(
        () =>
            leadTagId !== null &&
            (leadTagSource === "own" || leadTagSource === "suggested")
                ? { source: leadTagSource, tagId: leadTagId }
                : undefined,
        [leadTagId, leadTagSource],
    );
    const hasNextPage = pagination?.hasNextPage ?? false;
    const isLoadingNextPage = pagination?.isLoadingNextPage ?? false;
    const onLoadNextPage = pagination?.onLoadNextPage;
    const isLoadingMoreRef = useRef(false);
    const scroll = useScreenScroll<typeof AnimatedFlashList>();
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
    // how many songs each open group shows, past the first `GROUP_WINDOW`.
    // grows as the user scrolls near the end, and starts over when it closes
    const [groupLimits, setGroupLimits] =
        useState<ReadonlyMap<string, number>>(NO_GROUP_LIMITS);
    const limitOf = useCallback(
        (key: string) => groupLimits.get(key) ?? GROUP_WINDOW,
        [groupLimits],
    );
    const sectionCounts = useMemo(
        () =>
            new Map(
                (sections?.sections ?? []).map((section) => [
                    section.key,
                    section.count,
                ]),
            ),
        [sections],
    );
    const onSectionToggle = sections?.onToggle;
    const toggleSection = useCallback(
        (key: string) => {
            setGroupLimits((previous) => {
                if (!previous.has(key)) return previous;
                const next = new Map(previous);
                next.delete(key);
                return next;
            });
            onSectionToggle?.(key);
        },
        [onSectionToggle],
    );
    // a flat list's tracks are already without explicit songs when hidden;
    // a grouped list's are left out as its rows are made
    const hideExplicit = useHideExplicit();
    const rows = useMemo(
        () =>
            sections
                ? sectionRows(sections.sections, limitOf, hideExplicit)
                : tracks.map(
                      (track): MusicListRowItem => ({ type: "track", track }),
                  ),
        [hideExplicit, limitOf, sections, tracks],
    );
    // the songs on show, in order, which is what selection and tags read
    const displayedTracks = useMemo(
        () =>
            sections
                ? rows.flatMap((row) =>
                      row.type === "track" ? [row.track] : [],
                  )
                : tracks,
        [rows, sections, tracks],
    );
    // where each row's middle sits below the header, and where the rows end,
    // so a tinted page can pick each row's text color off its gradient. rows
    // differ in height once a list is grouped
    const { rowCenters, rowsHeight } = useMemo(() => {
        const centers: number[] = [];
        let top = 0;
        for (const row of rows) {
            const height = rowHeightOf(row, rowHeight);
            centers.push(top + height / 2);
            top += height;
        }
        return { rowCenters: centers, rowsHeight: top };
    }, [rowHeight, rows]);
    const selection = useMusicListSelection(displayedTracks, multiSelect);
    const { isSelecting, toggleSelection } = selection;
    const selectionCanApplyTags =
        multiSelect != null &&
        (multiSelect.actions == null ||
            multiSelect.actions.some((action) => action.kind === "apply-tags"));
    const localTagsEnabled =
        showTags || selection.isSelecting || leadTagSource === "own";
    const showSuggestedTagsInRows = showTags && showSuggestedTags;
    const defaultTagsEnabled =
        showSuggestedTagsInRows ||
        leadTagSource === "suggested" ||
        (selection.isSelecting &&
            selection.selectedTracks.length === 1 &&
            selectionCanApplyTags);
    const tagsEnabled =
        localTagsEnabled ||
        defaultTagsEnabled ||
        shownActivityTagIds.length > 0;
    // tags are read for the rows near the screen, not every song on show, so
    // a long list or a big group never asks for hundreds at once (suggested
    // tags are written by an LLM the first time a song is asked about). what
    // has been read stays read, so scrolling back never drops a row's tags
    const [readTagIds, setReadTagIds] = useState(NO_READ_TAG_IDS);
    const selectedTracks = selection.selectedTracks;
    const taggableIds = useMemo(() => {
        if (!tagsEnabled) return NO_SONG_IDS;
        // before the list reports what is on screen, the first rows
        const base =
            readTagIds.ids.length > 0
                ? readTagIds.ids
                : displayedTracks.slice(0, INITIAL_TAG_ROWS).map(songIdOf);
        // the selection toolbar reads the selected songs' tags
        const known = new Set(base);
        const selected = selectedTracks
            .map(songIdOf)
            .filter((songId) => !known.has(songId));
        return selected.length > 0 ? [...base, ...selected] : base;
    }, [displayedTracks, readTagIds, selectedTracks, tagsEnabled]);

    // the rows on screen, from the list. a ref, since it is only read when
    // the windows below are moved
    const viewRange = useRef<{ first: number; last: number } | null>(null);
    const moveWindows = useCallback(
        (first: number, last: number) => {
            if (sections) {
                const grow = groupsToGrow(
                    rows,
                    first,
                    last,
                    limitOf,
                    (key) => sectionCounts.get(key) ?? 0,
                );
                if (grow.length > 0) {
                    setGroupLimits((previous) => {
                        const next = new Map(previous);
                        for (const key of grow) {
                            // never past what this render meant, if the list
                            // reports twice before it renders again
                            next.set(
                                key,
                                Math.max(
                                    previous.get(key) ?? GROUP_WINDOW,
                                    limitOf(key) + GROUP_WINDOW,
                                ),
                            );
                        }
                        return next;
                    });
                }
            }
            if (tagsEnabled) {
                const ids = tagIdsToRead(
                    rows,
                    first,
                    last,
                    readTagIds.set,
                    songIdOf,
                );
                if (ids && ids.length > 0) {
                    setReadTagIds((previous) => {
                        const added = ids.filter(
                            (songId) => !previous.set.has(songId),
                        );
                        if (added.length === 0) return previous;
                        return {
                            ids: [...previous.ids, ...added],
                            set: new Set([...previous.set, ...added]),
                        };
                    });
                }
            }
        },
        [limitOf, readTagIds.set, rows, sectionCounts, sections, tagsEnabled],
    );
    const onWindowItemsChanged = useCallback(
        ({ viewableItems }: { viewableItems: ViewToken[] }) => {
            let first = Infinity;
            let last = -1;
            for (const token of viewableItems) {
                if (token.index == null) continue;
                first = Math.min(first, token.index);
                last = Math.max(last, token.index);
            }
            if (last < 0) return;
            viewRange.current = { first, last };
            moveWindows(first, last);
        },
        [moveWindows],
    );
    // the list only reports when other rows come on screen, not when the rows
    // under a still screen change, like a group opening or more songs landing
    useEffect(() => {
        const range = viewRange.current;
        if (range) moveWindows(range.first, range.last);
    }, [moveWindows]);
    const viewabilityPairs = useMemo(
        () => [
            {
                viewabilityConfig: WINDOW_VIEWABILITY,
                onViewableItemsChanged: onWindowItemsChanged,
            },
        ],
        [onWindowItemsChanged],
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
          : arrangementEnabled
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
            const seen = viewableItems.some((token) => {
                const row = token.item as MusicListRowItem;
                return (
                    token.isViewable &&
                    row.type === "track" &&
                    isHighlighted(row.track)
                );
            });
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
                    {/* always the list, loading included, so its background
                        and header are there from the first frame and the
                        header is never rebuilt when the rows land */}
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
                            maintainVisibleContentPosition={NO_CONTENT_POSITION}
                            // Overscrolling at the top is how a detail screen
                            // closes, and an indicator flicking in over the
                            // shrinking card is noise.
                            showsVerticalScrollIndicator={false}
                            data={rows}
                            extraData={listExtraData}
                            keyExtractor={rowKey}
                            getItemType={(row) => row.type}
                            renderItem={({ item: row, index }) => {
                                const surfaceOffset =
                                    headerHeight + (rowCenters[index] ?? 0);
                                if (row.type === "header") {
                                    return (
                                        <MusicListSectionHeader
                                            surfaceOffset={surfaceOffset}
                                            section={row.section}
                                            fullBleed={fullBleedRows}
                                            fullBleedHorizontalPadding={
                                                fullBleedRowHorizontalPadding
                                            }
                                            onToggle={toggleSection}
                                        />
                                    );
                                }
                                if (row.type === "loading") {
                                    return (
                                        <ContrastRegion offset={surfaceOffset}>
                                            <MusicListItemSkeleton
                                                fullBleed={fullBleedRows}
                                                fullBleedHorizontalPadding={
                                                    fullBleedRowHorizontalPadding
                                                }
                                                compact={isCompact}
                                            />
                                        </ContrastRegion>
                                    );
                                }
                                const item = row.track;
                                return (
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
                                            surfaceOffset={surfaceOffset}
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
                                            activityTagIds={shownActivityTagIds}
                                            lead={lead}
                                            leadValue={
                                                lead?.kind === "value"
                                                    ? leadValueOf(
                                                          lead.values,
                                                          item,
                                                      )
                                                    : undefined
                                            }
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
                                );
                            }}
                            contentContainerStyle={[
                                {
                                    paddingBottom: contentBottomInset,
                                    paddingHorizontal: fullBleedRows ? 0 : 24,
                                },
                                scroll.contentContainerStyle,
                            ]}
                            ListHeaderComponent={
                                header && tinted ? (
                                    <View
                                        onLayout={(event) =>
                                            setHeaderHeight(
                                                event.nativeEvent.layout.height,
                                            )
                                        }
                                    >
                                        {header}
                                    </View>
                                ) : header ? (
                                    <>{header}</>
                                ) : null
                            }
                            ListEmptyComponent={
                                isLoading ? (
                                    <View>
                                        {Array.from({
                                            length: Math.min(
                                                anticipatedTrackCount,
                                                MAX_INITIAL_SKELETON_ROWS,
                                            ),
                                        }).map((_, index) => (
                                            <MusicListItemSkeleton
                                                key={index}
                                                fullBleed={fullBleedRows}
                                                fullBleedHorizontalPadding={
                                                    fullBleedRowHorizontalPadding
                                                }
                                                compact={isCompact}
                                            />
                                        ))}
                                    </View>
                                ) : emptyContent !== undefined ? (
                                    <ContrastRegion offset={headerHeight}>
                                        {emptyContent}
                                    </ContrastRegion>
                                ) : (
                                    <Text className="text-muted-foreground text-center mt-10">
                                        Search for Artists, Songs, Lyrics, and
                                        More.
                                    </Text>
                                )
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
                                    <ContrastRegion
                                        offset={headerHeight + rowsHeight}
                                    >
                                        {footer}
                                    </ContrastRegion>
                                </>
                            }
                            onContentSizeChange={onContentSizeChange}
                            removeClippedSubviews={removeClippedSubviews}
                            onScroll={composedOnScroll}
                            onEndReached={handleEndReached}
                            onEndReachedThreshold={0.1}
                            viewabilityConfig={HIGHLIGHT_VIEWABILITY}
                            onViewableItemsChanged={onViewableItemsChanged}
                            viewabilityConfigCallbackPairs={viewabilityPairs}
                        />
                    </ContentBackgroundContext.Provider>
                </Animated.View>
            </GestureDetector>

            {arrangement && !selection.isSelecting ? (
                <MusicListArrangeButton
                    value={arrangement.value}
                    onChange={arrangement.onChange}
                />
            ) : null}

            <RowTagSource
                store={rowTagStore}
                songIds={taggableIds}
                loadTags={localTagsEnabled}
                loadSuggested={defaultTagsEnabled}
                showTags={showTags}
                showSuggested={showSuggestedTagsInRows}
                activityTagIds={shownActivityTagIds}
                lead={rowTagLead}
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
    MusicListArrangement,
    MusicListMultiSelectConfig,
    MusicListPagination,
    MusicListProps,
    MusicListSection,
    MusicListSections,
    MusicListSelectionAction,
    MusicListTrackAction,
} from "./types";

/** A row reading its own tags from the list's store, so only it re-renders. */
const MusicListRow = memo(function MusicListRow({
    store,
    songId,
    surfaceOffset,
    lead,
    leadValue,
    ...props
}: Omit<
    MusicListItemProps,
    "tags" | "defaultTags" | "activityTags" | "tagMetadata" | "lead"
> & {
    store: RowTagStore;
    songId: string;
    surfaceOffset: number;
    /** The tag the list is sorted by. */
    lead: SortLeadTag | null;
    /** This song's value of it, for a metadata tag. */
    leadValue?: string;
}) {
    const rowTags = useRowTags(store, songId);
    const railLead = useMemo<RailLead | undefined>(() => {
        if (!lead) return undefined;
        if (lead.kind === "tag") return lead;
        return leadValue != null
            ? { kind: "pill", tag: lead.tag, value: leadValue }
            : undefined;
    }, [lead, leadValue]);
    return (
        <ContrastRegion offset={surfaceOffset}>
            <MusicListItem {...props} {...rowTags} lead={railLead} />
        </ContrastRegion>
    );
});

/** A song's value in `values`, under whichever of its ids the list used. */
function leadValueOf(
    values: ReadonlyMap<string, string>,
    track: MusicItem,
): string | undefined {
    return (
        values.get(track.id) ??
        (track.catalogId ? values.get(track.catalogId) : undefined) ??
        (track.libraryId ? values.get(track.libraryId) : undefined)
    );
}

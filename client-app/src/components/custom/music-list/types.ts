import type Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem } from "@apple-musickit";
import type { ComponentProps, ReactNode } from "react";
import type { useAnimatedScrollHandler } from "react-native-reanimated";

import type { SongArrangement } from "@/lib/song-arrangement";
import type { ThemeColorToken } from "@/lib/theme";

/**
 * The list's Sort by and Group by choices, shown as a floating button. The
 * caller does the arranging (the backend sorts and groups) and hands the list
 * its songs, or its `sections`, already in order.
 */
export type MusicListArrangement = {
    value: SongArrangement;
    onChange: (arrangement: SongArrangement) => void;
};

/** One group of a grouped list, drawn as a header that opens and closes. */
export type MusicListSection = {
    key: string;
    label: string;
    /** Every song in the group, loaded or not. */
    count: number;
    expanded: boolean;
    /** The songs loaded so far, shown while the group is open. */
    tracks: MusicItem[];
    /** Open and still loading its first songs. */
    isLoading: boolean;
    /** Open with more songs to show than it has loaded. */
    hasMore: boolean;
};

export type MusicListSections = {
    sections: readonly MusicListSection[];
    onToggle: (key: string) => void;
    onShowMore: (key: string) => void;
};

export type MusicListPagination = {
    hasNextPage: boolean;
    isLoadingNextPage: boolean;
    onLoadNextPage: () => void | Promise<void>;
};

export type MusicListActionIcon = ComponentProps<typeof Ionicons>["name"];

export type MusicListAction<T> = {
    id: string;
    label: string;
    /** Optional Ionicon. When omitted, no icon is rendered. */
    icon?: MusicListActionIcon;
    /** Theme color used by the label. Defaults to `popoverForeground`. */
    labelColor?: ThemeColorToken;
    /** Theme color used by the icon. Defaults to the label color. */
    iconColor?: ThemeColorToken;
    onPress: (target: T) => void | Promise<void>;
};

export type MusicListTrackAction = MusicListAction<MusicItem> & {
    /** Whether using this action closes the song-options menu. Defaults to true. */
    dismissMenu?: boolean;
};

export type MusicListSelectionAction = MusicListAction<readonly MusicItem[]>;

export type MusicListSelectionActionDefinition =
    | { kind: "add-to-queue"; label?: string }
    | {
          kind: "apply-tags";
          label?: string;
          excludedTagIds?: readonly number[];
      }
    | { kind: "remove-tags"; label?: string }
    | { kind: "custom"; action: MusicListSelectionAction };

export type MusicListMultiSelectConfig = {
    /**
     * Exact left-to-right action order. Omit for Apply tags, Remove tags, then
     * Add to queue. Built-ins are discriminated so labels cannot accidentally
     * change behavior.
     */
    actions?: readonly MusicListSelectionActionDefinition[];
    /** Receives selected tracks in their current displayed order. */
    onSelectionChange?: (tracks: readonly MusicItem[]) => void;
};

export type MusicListProps = {
    tracks: MusicItem[];
    isLoading: boolean;
    /**
     * A song id (catalog, library, or plain) whose row shimmers the first time
     * it is on screen, then never again.
     */
    highlightTrackId?: string;
    /**
     * Replaces normal tap-to-play behavior. When null or omitted, tapping a
     * track uses the shared playback controller.
     */
    onTrackPressOverride?: ((track: MusicItem) => void | Promise<void>) | null;
    /**
     * Something to show on each row between the song and its options button,
     * like a play count on a ranked list. Opt in: without it every row is laid
     * out exactly as it was before this existed.
     */
    renderAccessory?: ((track: MusicItem) => ReactNode) | null;
    /** Actions appended after the built-in per-track actions. */
    trackMenuActions?: readonly MusicListTrackAction[];
    /**
     * Multi-selection is disabled when null or omitted. Supplying a config
     * enables long-press selection.
     */
    multiSelect?: MusicListMultiSelectConfig | null;
    /** Extends row backgrounds edge-to-edge while preserving content insets. */
    fullBleedRows?: boolean;
    /** Overrides the 18px content inset used by full-bleed rows. */
    fullBleedRowHorizontalPadding?: number;
    /** Theme surface beneath transparent rows and their tag-edge fade. */
    rowSurfaceColor?: ThemeColorToken;
    /** Removes screen-level bottom insets when nested in another surface. */
    embedded?: boolean;
    /** Controlled compactness. Omit to let pinch gestures own the value. */
    compact?: boolean;
    /** Receives compactness changes requested by pinch gestures. */
    onCompactChange?: (compact: boolean) => void;
    /** Whether to load and display Cadenza tags beneath each track. Defaults to true. */
    showTags?: boolean;
    /** Tag names placed first, in this order, in every row's tag rail. */
    mostRelevantTags?: readonly string[];
    /**
     * Activity tags to show first in every row's tag rail, with the row's own
     * value. Query results pass the ones the query filters on. Omitted or
     * empty, rows show no activity tags and none are fetched.
     */
    activityTagIds?: readonly number[];
    anticipatedTrackCount?: number;
    /** Content rendered above the first row inside the list's scroll surface. */
    header?: ReactNode;
    /** Backward-compatible alias for `header`. */
    listHeader?: ReactNode;
    /** Content rendered below pagination rows inside the scroll surface. */
    footer?: ReactNode;
    /** Shown in place of the songs when there are none and nothing is loading. */
    emptyContent?: ReactNode;
    /** Reports the complete scroll content size. */
    onContentSizeChange?: (width: number, height: number) => void;
    /**
     * Drawn behind the rows, filling the whole scroll content and scrolling
     * with it, like a page gradient. It spans the real content with nothing
     * measured, and is never virtualized away with an offscreen header.
     */
    contentBackground?: ReactNode;
    /** Controls native offscreen view clipping for backdrops that span the list. */
    removeClippedSubviews?: boolean;
    /** Optional scroll observer for coordinated header animation. */
    onScroll?: ReturnType<typeof useAnimatedScrollHandler>;
    /** Required pagination intent. Pass null for a non-paginated list. */
    pagination: MusicListPagination | null;
    /** Sort by and Group by are hidden when omitted or null. */
    arrangement?: MusicListArrangement | null;
    /**
     * A grouped list. Its headers and its open groups' songs replace `tracks`,
     * and `pagination` is ignored: each group loads its own.
     */
    sections?: MusicListSections | null;
};

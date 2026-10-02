import type Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem } from "@apple-musickit";
import type { ComponentProps, ReactNode } from "react";
import type { useAnimatedScrollHandler } from "react-native-reanimated";

import type { ThemeColorToken } from "@/lib/theme";

export const MUSIC_LIST_SORT_OPTIONS = [
    "title",
    "artist",
    "album",
    "dateAdded",
] as const;

export const DEFAULT_MUSIC_LIST_SORT_OPTIONS = [
    "title",
    "artist",
    "album",
] as const;

export type MusicListSortOption = (typeof MUSIC_LIST_SORT_OPTIONS)[number];

export type MusicListSortDirection = "ascending" | "descending";

export type MusicListSort = {
    option: MusicListSortOption;
    direction: MusicListSortDirection;
};

export type MusicListSorting = {
    /** The fields available from this list's sort control. */
    options?: readonly MusicListSortOption[];
    /** Controlled sort value. */
    value?: MusicListSort;
    /** Initial value when the list owns its sort state. */
    defaultValue?: MusicListSort;
    /** Remote sorting preserves the order returned across paginated pages. */
    strategy?: "local" | "remote";
    onChange?: (sort: MusicListSort) => void;
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
     * Replaces normal tap-to-play behavior. When null or omitted, tapping a
     * track uses the shared playback controller.
     */
    onTrackPressOverride?: ((track: MusicItem) => void | Promise<void>) | null;
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
    /** Reports the complete scroll content size. */
    onContentSizeChange?: (width: number, height: number) => void;
    /** Controls native offscreen view clipping for backdrops that span the list. */
    removeClippedSubviews?: boolean;
    /** Optional scroll observer for coordinated header animation. */
    onScroll?: ReturnType<typeof useAnimatedScrollHandler>;
    /** Required pagination intent. Pass null for a non-paginated list. */
    pagination: MusicListPagination | null;
    /** Sorting is disabled when omitted or null. Pass an object to enable it. */
    sorting?: MusicListSorting | null;
};

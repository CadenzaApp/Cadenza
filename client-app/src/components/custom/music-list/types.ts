import type Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem } from "@apple-musickit";
import type { ComponentProps } from "react";

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

export type MusicListMultiSelectConfig = {
    /** Include the built-in Add to Queue action. Defaults to true. */
    includeAddToQueue?: boolean;
    /** Additional actions shown after the built-in action. */
    actions?: readonly MusicListSelectionAction[];
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
    /** Extends row backgrounds and dividers edge-to-edge while preserving content insets. */
    fullBleedRows?: boolean;
    anticipatedTrackCount?: number;
    hasNextPage?: boolean;
    isLoadingNextPage?: boolean;
    onLoadNextPage?: () => void | Promise<void>;
    /** Enables client-side sorting and the sort-by control. */
    showSort?: boolean;
    /** The fields available from this list's sort control. */
    sortOptions?: readonly MusicListSortOption[];
    /** Controlled sort value. */
    sort?: MusicListSort;
    /** Initial value when the list owns its sort state. */
    defaultSort?: MusicListSort;
    onSortChange?: (sort: MusicListSort) => void;
};

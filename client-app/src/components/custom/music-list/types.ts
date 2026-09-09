import type { MusicItem } from "@apple-musickit";

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

export type MusicListProps = {
    tracks: MusicItem[];
    isLoading: boolean;
    activeTrackId: string | null;
    isPlaying: boolean;
    onTogglePlayback: (track: MusicItem) => void;
    onSelectTrack?: (track: MusicItem) => void;
    anticipatedTrackCount?: number;
    /** Required pagination intent. Pass null for a non-paginated list. */
    pagination: MusicListPagination | null;
    /** Sorting is disabled when omitted or null. Pass an object to enable it. */
    sorting?: MusicListSorting | null;
};

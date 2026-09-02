import type { MusicItem } from "@apple-musickit";

import type { Tag } from "@/lib/types";

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

export type MusicListProps = {
    tracks: MusicItem[];
    isLoading: boolean;
    activeTrackId: string | null;
    isPlaying: boolean;
    onTogglePlayback: (track: MusicItem) => void;
    onSelectTrack?: (track: MusicItem, tags: Tag[]) => void;
    songTagsMap?: Record<string, Tag[]>;
    anticipatedTrackCount?: number;
    hasNextPage?: boolean;
    isLoadingNextPage?: boolean;
    onLoadNextPage?: () => void | Promise<void>;
    /** Enables client-side sorting and the sort-by control. */
    showSort?: boolean;
    /** The fields available from this list's sort control. */
    sortOptions?: readonly MusicListSortOption[];
    initialSort?: MusicListSort;
    onSortChange?: (sort: MusicListSort) => void;
};

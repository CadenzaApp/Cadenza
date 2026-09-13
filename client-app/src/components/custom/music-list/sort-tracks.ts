import type { MusicItem } from "@apple-musickit";

import type {
    MusicListSort,
    MusicListSortDirection,
    MusicListSortOption,
} from "./types";

const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
});

export const MUSIC_LIST_SORT_LABELS: Record<MusicListSortOption, string> = {
    title: "Title",
    artist: "Artist",
    album: "Album",
    dateAdded: "Date Added",
};

export function sortTracks(
    tracks: MusicItem[],
    sort: MusicListSort,
): MusicItem[] {
    const direction = sort.direction === "ascending" ? 1 : -1;

    return [...tracks].sort((left, right) => {
        const optionComparison = compareSortValue(left, right, sort.option);

        if (optionComparison !== 0) return optionComparison * direction;

        const titleComparison =
            collator.compare(left.title, right.title) * direction;
        if (titleComparison !== 0) return titleComparison;

        return collator.compare(left.id, right.id) * direction;
    });
}

export function nextSort(
    currentSort: MusicListSort,
    option: MusicListSortOption,
): MusicListSort {
    if (currentSort.option !== option) {
        return { option, direction: currentSort.direction };
    }

    return {
        option,
        direction: toggleSortDirection(currentSort.direction),
    };
}

function compareSortValue(
    left: MusicItem,
    right: MusicItem,
    option: MusicListSortOption,
): number {
    if (option === "dateAdded") {
        const leftDate = left.libraryAddedDate;
        const rightDate = right.libraryAddedDate;

        if (leftDate == null && rightDate == null) return 0;
        if (leftDate == null) return -1;
        if (rightDate == null) return 1;

        return leftDate - rightDate;
    }

    return collator.compare(sortValue(left, option), sortValue(right, option));
}

function sortValue(
    item: MusicItem,
    option: Exclude<MusicListSortOption, "dateAdded">,
): string {
    switch (option) {
        case "artist":
            return item.artistName ?? "";
        case "album":
            return item.albumName ?? "";
        case "title":
            return item.title;
    }
}

function toggleSortDirection(
    direction: MusicListSortDirection,
): MusicListSortDirection {
    return direction === "ascending" ? "descending" : "ascending";
}

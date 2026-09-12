import type Ionicons from "@expo/vector-icons/Ionicons";

/** A section of the library that the user can browse into. */
export type LibraryCategory = "playlist" | "album" | "song" | "tag";

/** Display order on the library screen. Not the enabled/disabled state. */
export const LIBRARY_CATEGORY_ORDER = [
    "playlist",
    "album",
    "song",
    "tag",
] as const satisfies readonly LibraryCategory[];

type CategoryMeta = {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
};

export const LIBRARY_CATEGORY_META: Record<LibraryCategory, CategoryMeta> = {
    playlist: { label: "Playlists", icon: "list" },
    album: { label: "Albums", icon: "disc" },
    song: { label: "Songs", icon: "musical-note" },
    tag: { label: "Tags", icon: "pricetags" },
};

/** Categories that hold Apple Music collections openable by id. */
export function isCollectionCategory(
    category: LibraryCategory,
): category is "album" | "playlist" {
    return category === "album" || category === "playlist";
}

export function parseLibraryCategory(
    value: string | undefined,
): LibraryCategory | undefined {
    return LIBRARY_CATEGORY_ORDER.find((category) => category === value);
}

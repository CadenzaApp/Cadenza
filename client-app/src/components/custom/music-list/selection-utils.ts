import type { MusicItem } from "@apple-musickit";

export function tracksSelectedInDisplayOrder(
    tracks: readonly MusicItem[],
    selectedIds: ReadonlySet<string>,
) {
    return tracks.filter((track) => selectedIds.has(track.id));
}

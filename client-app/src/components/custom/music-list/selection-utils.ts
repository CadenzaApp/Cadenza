import type { MusicItem } from "@apple-musickit";

export type MusicListSelectionAction =
    | { type: "select"; id: string }
    | { type: "toggle"; id: string }
    | { type: "add_span"; ids: readonly string[] }
    | { type: "reconcile"; availableIds: ReadonlySet<string> }
    | { type: "clear" };

export function reduceMusicListSelection(
    selectedIds: ReadonlySet<string>,
    action: MusicListSelectionAction,
): ReadonlySet<string> {
    if (action.type === "add_span") {
        const next = new Set(selectedIds);
        for (const id of action.ids) next.add(id);
        return next.size === selectedIds.size ? selectedIds : next;
    }
    if (action.type === "clear") {
        return selectedIds.size === 0 ? selectedIds : new Set();
    }

    if (action.type === "reconcile") {
        const retainedIds = [...selectedIds].filter((id) =>
            action.availableIds.has(id),
        );
        return retainedIds.length === selectedIds.size
            ? selectedIds
            : new Set(retainedIds);
    }

    const nextIds = new Set(selectedIds);
    if (action.type === "toggle" && nextIds.has(action.id)) {
        nextIds.delete(action.id);
    } else {
        if (nextIds.has(action.id)) return selectedIds;
        nextIds.add(action.id);
    }
    return nextIds;
}

export function tracksSelectedInDisplayOrder(
    tracks: readonly MusicItem[],
    selectedIds: ReadonlySet<string>,
) {
    return tracks.filter((track) => selectedIds.has(track.id));
}

/** A live drag replaces its own span while preserving selections from prior gestures. */
export function previewDragSelection(
    base: ReadonlySet<string>,
    span: readonly string[],
): ReadonlySet<string> {
    return new Set([...base, ...span]);
}

import type { MusicItem } from "@apple-musickit";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MusicListMultiSelectConfig } from "./types";
import { reduceMusicListSelection } from "./selection-utils";

const EMPTY_SELECTION: ReadonlySet<string> = new Set();
const NO_TRACKS: MusicItem[] = [];
const NO_TRACK_INDEX: ReadonlyMap<string, { track: MusicItem; index: number }> =
    new Map();

export function useMusicListSelection(
    displayedTracks: readonly MusicItem[],
    config?: MusicListMultiSelectConfig | null,
) {
    const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
        () => new Set(),
    );
    const clearHapticRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
        () => () => {
            if (clearHapticRef.current) clearTimeout(clearHapticRef.current);
        },
        [],
    );
    const enabled = config != null;
    // only built while something is selected: a grouped list's rows change
    // every time a group opens, and nothing reads these otherwise
    const hasSelection = enabled && selectedIds.size > 0;
    const displayedTrackIndex = useMemo(
        () =>
            hasSelection
                ? new Map(
                      displayedTracks.map((track, index) => [
                          track.id,
                          { track, index },
                      ]),
                  )
                : NO_TRACK_INDEX,
        [displayedTracks, hasSelection],
    );
    const selectedTracks = useMemo(() => {
        if (!hasSelection) return NO_TRACKS;
        return [...selectedIds]
            .flatMap((id) => {
                const item = displayedTrackIndex.get(id);
                return item ? [item] : [];
            })
            .sort((left, right) => left.index - right.index)
            .map(({ track }) => track);
    }, [displayedTrackIndex, hasSelection, selectedIds]);
    const isSelecting = enabled && selectedIds.size > 0;

    const onSelectionChange = config?.onSelectionChange;
    useEffect(() => {
        onSelectionChange?.(selectedTracks);
    }, [onSelectionChange, selectedTracks]);

    useEffect(() => {
        // Selection is scoped to the currently displayed result set.
        if (!hasSelection && enabled) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedIds((currentIds) =>
            reduceMusicListSelection(
                currentIds,
                enabled
                    ? {
                          type: "reconcile",
                          availableIds: new Set(displayedTrackIndex.keys()),
                      }
                    : { type: "clear" },
            ),
        );
    }, [displayedTrackIndex, enabled, hasSelection]);

    const beginSelection = useCallback(
        (track: MusicItem) => {
            if (!enabled) return;
            triggerSelectionHaptic();
            setSelectedIds((currentIds) =>
                reduceMusicListSelection(currentIds, {
                    type: "select",
                    id: track.id,
                }),
            );
        },
        [enabled],
    );

    const toggleSelection = useCallback(
        (track: MusicItem) => {
            if (!enabled) return;
            triggerSelectionHaptic();
            setSelectedIds((currentIds) =>
                reduceMusicListSelection(currentIds, {
                    type: "toggle",
                    id: track.id,
                }),
            );
        },
        [enabled],
    );

    const clearSelection = useCallback(() => {
        // Double tap, so leaving selection mode feels different from toggling.
        triggerSelectionHaptic();
        const secondTap = setTimeout(triggerSelectionHaptic, 150);
        clearHapticRef.current = secondTap;
        setSelectedIds((currentIds) =>
            reduceMusicListSelection(currentIds, { type: "clear" }),
        );
    }, []);

    return {
        enabled,
        isSelecting,
        selectedIds: enabled ? selectedIds : EMPTY_SELECTION,
        selectedTracks,
        beginSelection,
        toggleSelection,
        clearSelection,
    };
}

function triggerSelectionHaptic() {
    void Haptics.selectionAsync().catch(() => {
        // Haptics are best-effort and should never block selection.
    });
}

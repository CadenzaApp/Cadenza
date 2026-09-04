import type { MusicItem } from "@apple-musickit";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState } from "react";

import type { MusicListMultiSelectConfig } from "./types";

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

export function useMusicListSelection(
    displayedTracks: readonly MusicItem[],
    config?: MusicListMultiSelectConfig | null,
) {
    const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
        () => new Set(),
    );
    const previousSelectedIdsRef = useRef<ReadonlySet<string>>(EMPTY_SELECTION);
    const enabled = config != null;
    const displayedTrackIndex = useMemo(
        () =>
            new Map(
                displayedTracks.map((track, index) => [
                    track.id,
                    { track, index },
                ]),
            ),
        [displayedTracks],
    );
    const selectedTracks = useMemo(() => {
        if (!enabled) return [];
        return [...selectedIds]
            .flatMap((id) => {
                const entry = displayedTrackIndex.get(id);
                return entry ? [entry] : [];
            })
            .sort((left, right) => left.index - right.index)
            .map(({ track }) => track);
    }, [displayedTrackIndex, enabled, selectedIds]);
    const isSelecting = selectedTracks.length > 0;

    const onSelectionChange = config?.onSelectionChange;
    useEffect(() => {
        onSelectionChange?.(selectedTracks);
    }, [onSelectionChange, selectedTracks]);

    useEffect(() => {
        const previousIds = previousSelectedIdsRef.current;
        previousSelectedIdsRef.current = selectedIds;
        const selectionChanged =
            previousIds.size !== selectedIds.size ||
            [...selectedIds].some((id) => !previousIds.has(id));

        if (!selectionChanged) return;

        triggerSelectionHaptic();
        if (previousIds.size > 0 && selectedIds.size === 0) {
            const secondTap = setTimeout(triggerSelectionHaptic, 150);
            return () => clearTimeout(secondTap);
        }
    }, [selectedIds]);

    function beginSelection(track: MusicItem) {
        if (!enabled) return;
        setSelectedIds((currentIds) => {
            if (currentIds.has(track.id)) return currentIds;
            const nextIds = new Set(currentIds);
            nextIds.add(track.id);
            return nextIds;
        });
    }

    function toggleSelection(track: MusicItem) {
        if (!enabled) return;
        setSelectedIds((currentIds) => {
            const nextIds = new Set(currentIds);
            if (nextIds.has(track.id)) nextIds.delete(track.id);
            else nextIds.add(track.id);
            return nextIds;
        });
    }

    function clearSelection() {
        setSelectedIds(new Set());
    }

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

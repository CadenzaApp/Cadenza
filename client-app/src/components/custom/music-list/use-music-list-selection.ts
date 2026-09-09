import type { MusicItem } from "@apple-musickit";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MusicListMultiSelectConfig } from "./types";
import {
    reduceMusicListSelection,
    tracksSelectedInDisplayOrder,
} from "./selection-utils";

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
    const displayedIds = useMemo(
        () => new Set(displayedTracks.map((track) => track.id)),
        [displayedTracks],
    );
    const selectedTracks = useMemo(() => {
        if (!enabled) return [];
        return tracksSelectedInDisplayOrder(displayedTracks, selectedIds);
    }, [displayedTracks, enabled, selectedIds]);
    const isSelecting = selectedTracks.length > 0;

    const onSelectionChange = config?.onSelectionChange;
    useEffect(() => {
        onSelectionChange?.(selectedTracks);
    }, [onSelectionChange, selectedTracks]);

    useEffect(() => {
        // Selection is scoped to the currently displayed result set.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedIds((currentIds) =>
            reduceMusicListSelection(
                currentIds,
                enabled
                    ? { type: "reconcile", availableIds: displayedIds }
                    : { type: "clear" },
            ),
        );
    }, [displayedIds, enabled]);

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

    const beginSelection = useCallback(
        (track: MusicItem) => {
            if (!enabled) return;
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

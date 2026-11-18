import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { FlashListRef } from "@shopify/flash-list";
import type { LayoutChangeEvent } from "react-native";
import { usePanGesture } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import type { MusicItem } from "@apple-musickit";
import type { MusicListRowItem } from "./list-windows";
import { rowAtPosition, selectionScrollSpeed } from "./drag-selection";

/** One detector owns a hold and drag even while FlashList recycles song rows. */
export function useDragSelection({
    rows,
    listRef,
    enabled,
    onSelect,
}: {
    rows: MusicListRowItem[];
    listRef: RefObject<FlashListRef<MusicListRowItem> | null>;
    enabled: boolean;
    onSelect: (tracks: readonly MusicItem[], first: boolean) => void;
}) {
    const latest = useRef({ rows, onSelect });
    useEffect(() => {
        latest.current = { rows, onSelect };
    }, [rows, onSelect]);
    const state = useRef({
        active: false,
        y: 0,
        height: 0,
        lastId: "",
        anchorId: "",
        frame: 0,
        time: 0,
    });
    const stop = useCallback(() => {
        state.current.active = false;
        cancelAnimationFrame(state.current.frame);
    }, []);
    useEffect(() => {
        if (!enabled) stop();
        return stop;
    }, [enabled, stop]);
    const visit = useCallback(() => {
        const list = listRef.current;
        if (!list) return false;
        const current = state.current;
        const items = latest.current.rows;
        const { startIndex, endIndex } = list.computeVisibleIndices();
        const hit = rowAtPosition(
            Math.max(0, endIndex - startIndex + 1),
            Math.max(0, Math.min(current.height - 1, current.y)) +
                list.getAbsoluteLastScrollOffset() -
                list.getFirstItemOffset(),
            (i) => list.getLayout(startIndex + i),
        );
        const index = hit < 0 ? -1 : startIndex + hit;
        const row = items[index];
        if (row?.type !== "track") return false;
        if (current.lastId === row.track.id) return true;
        const previous = items.findIndex(
            (item) =>
                item.type === "track" && item.track.id === current.anchorId,
        );
        const start = previous < 0 ? index : Math.min(previous, index);
        const end = previous < 0 ? index : Math.max(previous, index);
        latest.current.onSelect(
            items
                .slice(start, end + 1)
                .flatMap((item) => (item.type === "track" ? [item.track] : [])),
            !current.anchorId,
        );
        if (!current.anchorId) current.anchorId = row.track.id;
        current.lastId = row.track.id;
        return true;
    }, [listRef]);
    const tick = useCallback(
        function tick(time: number) {
            const current = state.current;
            if (!current.active) return;
            const list = listRef.current;
            const elapsed = Math.min(32, Math.max(0, time - current.time));
            current.time = time;
            if (list) {
                const speed = selectionScrollSpeed(current.y, current.height);
                if (speed) {
                    const max = Math.max(
                        0,
                        list.getChildContainerDimensions().height +
                            list.getFirstItemOffset() -
                            current.height,
                    );
                    const offset = Math.max(
                        0,
                        Math.min(
                            max,
                            list.getAbsoluteLastScrollOffset() +
                                (speed * elapsed) / 1000,
                        ),
                    );
                    list.scrollToOffset({ offset, animated: false });
                }
                visit();
            }
            current.frame = requestAnimationFrame(tick);
        },
        [listRef, visit],
    );
    const start = useCallback(
        (y: number) => {
            stop();
            const current = state.current;
            current.y = y;
            current.lastId = "";
            current.anchorId = "";
            if (!visit()) return;
            current.active = true;
            current.time = performance.now();
            current.frame = requestAnimationFrame(tick);
        },
        [stop, visit, tick],
    );
    const move = useCallback((y: number) => {
        state.current.y = y;
    }, []);
    const gesture = usePanGesture({
        enabled,
        activateAfterLongPress: 300,
        failOffsetY: [-12, 12],
        failOffsetX: [-20, 20],
        onActivate: (event) => {
            "worklet";
            runOnJS(start)(event.y);
        },
        onUpdate: (event) => {
            "worklet";
            runOnJS(move)(event.y);
        },
        onFinalize: () => {
            "worklet";
            runOnJS(stop)();
        },
    });
    const onLayout = useCallback((event: LayoutChangeEvent) => {
        state.current.height = event.nativeEvent.layout.height;
    }, []);
    return { gesture, onLayout };
}

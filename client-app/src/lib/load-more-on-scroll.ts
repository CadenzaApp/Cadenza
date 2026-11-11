import { useCallback, useRef } from "react";
import type {
    LayoutChangeEvent,
    NativeScrollEvent,
    NativeSyntheticEvent,
} from "react-native";

const NEAR_END_PX = 240;

/**
 * Fires `onLoadMore` when a scroll view is within 240px of the bottom, or
 * shorter than its viewport. Drag and momentum end cover a fling. Content
 * size covers a page that does not fill the screen.
 *
 * `onScroll` is separate so a screen can keep its own scroll handler, such
 * as the top rail's.
 */
export function useLoadMoreOnScroll(onLoadMore: () => void) {
    const viewport = useRef(0);
    const content = useRef(0);
    const offset = useRef(0);

    const check = useCallback(() => {
        if (viewport.current <= 0) return;
        const distance = content.current - viewport.current - offset.current;
        if (distance < NEAR_END_PX) onLoadMore();
    }, [onLoadMore]);

    const onLayout = useCallback(
        (event: LayoutChangeEvent) => {
            viewport.current = event.nativeEvent.layout.height;
            check();
        },
        [check],
    );

    const onContentSizeChange = useCallback(
        (_width: number, height: number) => {
            content.current = height;
            check();
        },
        [check],
    );

    const onScrollEnd = useCallback(
        (event: NativeSyntheticEvent<NativeScrollEvent>) => {
            const native = event.nativeEvent;
            viewport.current = native.layoutMeasurement.height;
            content.current = native.contentSize.height;
            offset.current = native.contentOffset.y;
            check();
        },
        [check],
    );

    const onScroll = useCallback(
        (event: NativeSyntheticEvent<NativeScrollEvent>) => {
            offset.current = event.nativeEvent.contentOffset.y;
            viewport.current = event.nativeEvent.layoutMeasurement.height;
            content.current = event.nativeEvent.contentSize.height;
            check();
        },
        [check],
    );

    return {
        onLayout,
        onContentSizeChange,
        onMomentumScrollEnd: onScrollEnd,
        onScrollEndDrag: onScrollEnd,
        onScroll,
    };
}

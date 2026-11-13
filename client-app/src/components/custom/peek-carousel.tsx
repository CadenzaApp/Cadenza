import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useRef, useState, type ReactNode } from "react";
import {
    ScrollView,
    useWindowDimensions,
    View,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
} from "react-native";

/** Screen padding the carousel bleeds past, matching the screens' `px-5`. */
const DEFAULT_GUTTER = 20;
const DEFAULT_GAP = 12;
/** How much of the next item shows past the last full one. */
const DEFAULT_PEEK = 44;

const FILL = {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
} as const;
const MASK_ROW = { ...FILL, flexDirection: "row" } as const;
const MASK_SOLID = { flex: 1, backgroundColor: "black" } as const;
const OPAQUE = ["black", "black"] as const;
const FADE_IN = ["transparent", "black"] as const;
const FADE_OUT = ["black", "transparent"] as const;

/** Whether the row is scrolled to each end. */
type Edges = { start: boolean; end: boolean };

/**
 * A horizontal row that shows `visible` items whole and a peek of the next,
 * snapping one item at a time. An edge with more items past it fades out, so
 * the cut off item reads as more to swipe to. It bleeds past the screen's side
 * padding, so place it inside a `px-5` column.
 */
export function PeekCarousel<T>({
    items,
    keyOf,
    renderItem,
    visible = 2,
    peek = DEFAULT_PEEK,
    gap = DEFAULT_GAP,
    gutter = DEFAULT_GUTTER,
    trailing,
}: {
    items: readonly T[];
    keyOf: (item: T, index: number) => string;
    /** Draws one item at `width`, the same for every item. */
    renderItem: (item: T, width: number, index: number) => ReactNode;
    /** Items shown whole before the peek. */
    visible?: number;
    peek?: number;
    gap?: number;
    gutter?: number;
    /** Drawn after the items, at item width, like a See all tile. */
    trailing?: (width: number) => ReactNode;
}) {
    const { width: screenWidth } = useWindowDimensions();
    const itemWidth = Math.floor(
        (screenWidth - gutter - peek - gap * visible) / visible,
    );
    const count = items.length + (trailing ? 1 : 0);
    const overflows = count > visible;

    // only the yes or no is state, so scrolling renders again only when an
    // edge starts or stops fading. before the first scroll it is at the start
    const [scrolled, setScrolled] = useState<Edges | null>(null);
    const scrolledRef = useRef<Edges | null>(null);
    const edges = scrolled ?? { start: true, end: !overflows };
    function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
        const { contentOffset, contentSize, layoutMeasurement } =
            event.nativeEvent;
        const next = {
            start: contentOffset.x <= 1,
            end:
                contentOffset.x + layoutMeasurement.width >=
                contentSize.width - 1,
        };
        const current = scrolledRef.current;
        if (current?.start === next.start && current.end === next.end) return;
        scrolledRef.current = next;
        setScrolled(next);
    }

    const row = (
        <ScrollView
            horizontal
            directionalLockEnabled
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            snapToInterval={itemWidth + gap}
            snapToAlignment="start"
            disableIntervalMomentum
            scrollEventThrottle={32}
            onScroll={overflows ? onScroll : undefined}
            contentContainerStyle={{ gap, paddingHorizontal: gutter }}
        >
            {items.map((item, index) => (
                <View key={keyOf(item, index)} style={{ width: itemWidth }}>
                    {renderItem(item, itemWidth, index)}
                </View>
            ))}
            {trailing ? (
                <View style={{ width: itemWidth }}>{trailing(itemWidth)}</View>
            ) : null}
        </ScrollView>
    );

    return (
        <View style={{ marginHorizontal: -gutter }}>
            {overflows ? (
                // the mask stays mounted while it overflows, and only its
                // colors change, so the row keeps its scroll position
                <MaskedView
                    maskElement={
                        <View style={MASK_ROW}>
                            <LinearGradient
                                style={{ width: peek }}
                                colors={edges.start ? OPAQUE : FADE_IN}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                            />
                            <View style={MASK_SOLID} />
                            <LinearGradient
                                style={{ width: peek }}
                                colors={edges.end ? OPAQUE : FADE_OUT}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                            />
                        </View>
                    }
                >
                    {row}
                </MaskedView>
            ) : (
                row
            )}
        </View>
    );
}

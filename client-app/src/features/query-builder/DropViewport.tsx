import {
    createContext,
    useContext,
    useMemo,
    useRef,
    type ReactNode,
} from "react";
import { View, type ViewProps } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { measureDropRect, type DropRect } from "./drag-utils";

export type DropViewportGeometry = {
    measure: () => Promise<DropRect | null>;
    scrollY?: SharedValue<number>;
    translationY?: SharedValue<number>;
    topInset: number;
    bottomInset: number | SharedValue<number>;
};
const Context = createContext<DropViewportGeometry | null>(null);
export const useDropViewport = () => useContext(Context);

/** Every target inside a scrolling region shares its movement and clipping. */
export function DropViewport({
    scrollY,
    translationY,
    topInset = 0,
    bottomInset = 0,
    children,
    ...props
}: ViewProps & {
    scrollY?: SharedValue<number>;
    translationY?: SharedValue<number>;
    topInset?: number;
    bottomInset?: number | SharedValue<number>;
    children: ReactNode;
}) {
    const ref = useRef<View>(null);
    const geometry = useMemo<DropViewportGeometry>(
        () => ({
            scrollY,
            translationY,
            topInset,
            bottomInset,
            measure: () => measureDropRect(ref.current),
        }),
        [scrollY, translationY, topInset, bottomInset],
    );
    return (
        <Context.Provider value={geometry}>
            <View ref={ref} collapsable={false} {...props}>
                {children}
            </View>
        </Context.Provider>
    );
}

import type { ReactNode } from "react";
import { ScrollViewMarker } from "react-native-screens/experimental";

/** Registers a nested React Native scroller with its native stack and tab hosts. */
export function ScreenScrollMarker({
    children,
}: {
    children: NonNullable<ReactNode>;
}) {
    return <ScrollViewMarker style={{ flex: 1 }}>{children}</ScrollViewMarker>;
}

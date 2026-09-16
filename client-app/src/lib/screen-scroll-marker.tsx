import { Fragment, type ReactNode } from "react";

/** Scroll-view registration is an iOS native-tabs concern. */
export function ScreenScrollMarker({
    children,
}: {
    children: NonNullable<ReactNode>;
}) {
    return <Fragment>{children}</Fragment>;
}

import { Link, type Href } from "expo-router";
import type { ReactElement, ReactNode } from "react";
import { Pressable, type PressableProps } from "react-native";

type ZoomTileProps = Omit<PressableProps, "children"> & {
    /**
     * Where the tile goes. The new screen grows out of `artwork` with the iOS
     * 18 zoom and pushes inside the current tab. Null leaves a plain
     * pressable that only runs `onPress`.
     */
    href: Href | null;
    /** One view the zoom grows out of and shrinks back into. */
    artwork: ReactElement;
    children?: ReactNode;
};

/**
 * A pressable tile that opens a screen with the native zoom transition.
 * `onPress` still runs first, for side effects like closing the keyboard.
 * Android and older iOS get a plain push.
 */
export function ZoomTile({
    href,
    artwork,
    children,
    onPress,
    ...rest
}: ZoomTileProps) {
    if (!href) {
        return (
            <Pressable {...rest} onPress={onPress}>
                {artwork}
                {children}
            </Pressable>
        );
    }

    return (
        <Link
            href={href}
            push
            asChild
            onPress={onPress ? (event) => onPress(event as never) : undefined}
        >
            <Pressable {...rest}>
                <Link.AppleZoom>{artwork}</Link.AppleZoom>
                {children}
            </Pressable>
        </Link>
    );
}

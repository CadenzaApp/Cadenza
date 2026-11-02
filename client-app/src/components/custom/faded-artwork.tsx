import MaskedView from "@react-native-masked-view/masked-view";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import type { ComponentProps, ReactNode } from "react";
import { StyleSheet, View } from "react-native";

/** Where a square cover sits in its box, in points. */
export type CoverFrame = { left: number; top: number; size: number };

type FadedArtworkProps = {
    /** Null shows `fallback` instead. */
    uri?: string | null;
    /** A smaller, likely cached copy shown while `uri` loads. */
    placeholderUri?: string | null;
    /** Fraction of the height where the bottom fade starts. */
    fadeStart: number;
    /**
     * Draw the cover whole at this frame and fill any room left above or
     * beside it with flipped copies. Left out, the image is cropped to cover
     * the box.
     */
    cover?: CoverFrame;
    /** Drawn under the same mask when there is no `uri`. */
    fallback?: ReactNode;
};

/**
 * Artwork filling its parent edge to edge that fades into whatever is behind
 * it at the bottom instead of ending on a hard line. Absolutely positioned, so
 * the caller sizes it.
 *
 * `expo-image` rather than the React Native one: it caches to disk, decodes off
 * the JS thread, and shows `placeholderUri` while the large image comes down.
 */
export function FadedArtwork({
    uri,
    placeholderUri,
    fadeStart,
    cover,
    fallback = null,
}: FadedArtworkProps) {
    return (
        <MaskedView
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            // Cache this static image+mask composite while the parent scrolls.
            shouldRasterizeIOS
            renderToHardwareTextureAndroid
            maskElement={
                <LinearGradient
                    style={StyleSheet.absoluteFill}
                    colors={["#000000", "#000000", "transparent"]}
                    locations={[0, fadeStart, 1]}
                />
            }
        >
            {!uri ? (
                fallback
            ) : cover ? (
                <MirroredCover
                    uri={uri}
                    placeholderUri={placeholderUri}
                    frame={cover}
                />
            ) : (
                <Cover
                    uri={uri}
                    placeholderUri={placeholderUri}
                    style={StyleSheet.absoluteFill}
                />
            )}
        </MaskedView>
    );
}

/**
 * The cover at `frame`, with a copy flipped across each edge that has room
 * past it: up over the top, out to the left and right when the cover is
 * narrower than the box, and the top corners flipped both ways. Every copy is
 * the same cached image.
 */
function MirroredCover({
    uri,
    placeholderUri,
    frame,
}: {
    uri: string;
    placeholderUri?: string | null;
    frame: CoverFrame;
}) {
    const columns = frame.left > 0 ? [-1, 0, 1] : [0];
    const rows = frame.top > 0 ? [-1, 0] : [0];

    return (
        <View style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
            {rows.flatMap((row) =>
                columns.map((column) => (
                    <Cover
                        key={`${row}:${column}`}
                        uri={uri}
                        placeholderUri={placeholderUri}
                        style={{
                            position: "absolute",
                            left: frame.left + column * frame.size,
                            top: frame.top + row * frame.size,
                            width: frame.size,
                            height: frame.size,
                            transform: [
                                { scaleX: column === 0 ? 1 : -1 },
                                { scaleY: row === 0 ? 1 : -1 },
                            ],
                        }}
                    />
                )),
            )}
        </View>
    );
}

function Cover({
    uri,
    placeholderUri,
    style,
}: {
    uri: string;
    placeholderUri?: string | null;
    style: ComponentProps<typeof Image>["style"];
}) {
    return (
        <Image
            source={{ uri }}
            placeholder={placeholderUri ? { uri: placeholderUri } : undefined}
            placeholderContentFit="cover"
            contentFit="cover"
            cachePolicy="memory-disk"
            priority="high"
            transition={0}
            style={style}
        />
    );
}

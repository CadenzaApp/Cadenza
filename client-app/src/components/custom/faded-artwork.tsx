import MaskedView from "@react-native-masked-view/masked-view";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useState, type ComponentProps, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

type FadedArtworkProps = {
    /** Null shows `fallback` instead. */
    uri?: string | null;
    /** A smaller, likely cached copy shown while `uri` loads. */
    placeholderUri?: string | null;
    /** Fraction of the height where the bottom fade starts. */
    fadeStart: number;
    /**
     * Keep a square cover whole at the bottom of the box and fill the room
     * above and beside it with flipped copies, rather than cropping it to
     * cover. See `mirroredCoverFrame`.
     */
    mirrored?: boolean;
    /** With `mirrored`, the cover's size as a fraction of the most that fits. */
    coverScale?: number;
    /** Drawn under the same mask when there is no `uri`. */
    fallback?: ReactNode;
};

type Frame = { left: number; top: number; size: number };

/**
 * Where a mirrored square cover sits in a `width` x `height` box: `scale` of
 * the most that fits, centered across, and on the bottom edge. The room left
 * above and to each side is what the flipped copies fill.
 */
export function mirroredCoverFrame(
    width: number,
    height: number,
    scale = 1,
): Frame {
    const size = Math.min(width, height) * scale;
    return { left: (width - size) / 2, top: height - size, size };
}

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
    mirrored = false,
    coverScale = 1,
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
            ) : mirrored ? (
                <MirroredCover
                    uri={uri}
                    placeholderUri={placeholderUri}
                    scale={coverScale}
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
 * The cover at `mirroredCoverFrame`, with a copy flipped across each edge that
 * has room past it: up over the top, out to the left and right, and the two
 * top corners flipped both ways. Every copy is the same cached image.
 */
function MirroredCover({
    uri,
    placeholderUri,
    scale,
}: {
    uri: string;
    placeholderUri?: string | null;
    scale: number;
}) {
    const [box, setBox] = useState<{ width: number; height: number } | null>(
        null,
    );
    const frame = box ? mirroredCoverFrame(box.width, box.height, scale) : null;
    const columns = frame && frame.left > 0 ? [-1, 0, 1] : [0];
    const rows = frame && frame.top > 0 ? [-1, 0] : [0];

    return (
        <View
            style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}
            onLayout={(event) => setBox(event.nativeEvent.layout)}
        >
            {frame
                ? rows.flatMap((row) =>
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
                  )
                : null}
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

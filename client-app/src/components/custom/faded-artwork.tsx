import MaskedView from "@react-native-masked-view/masked-view";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { StyleSheet } from "react-native";

type FadedArtworkProps = {
    /** Null shows `fallback` instead. */
    uri?: string | null;
    /** A smaller, likely cached copy shown while `uri` loads. */
    placeholderUri?: string | null;
    /** Fraction of the height where the bottom fade starts. */
    fadeStart: number;
    /** Fraction of the width each side fades over. 0 leaves hard sides. */
    edgeFade?: number;
    /** Drawn under the same masks when there is no `uri`. */
    fallback?: ReactNode;
};

/**
 * Artwork filling its parent edge to edge, cropped to cover, that fades into
 * whatever is behind it at the bottom (and the sides with `edgeFade`) instead
 * of ending on a hard line. Absolutely positioned, so the caller sizes it.
 *
 * `expo-image` rather than the React Native one: it caches to disk, decodes off
 * the JS thread, and shows `placeholderUri` while the large image comes down.
 */
export function FadedArtwork({
    uri,
    placeholderUri,
    fadeStart,
    edgeFade = 0,
    fallback = null,
}: FadedArtworkProps) {
    const content = uri ? (
        <Image
            source={{ uri }}
            placeholder={placeholderUri ? { uri: placeholderUri } : undefined}
            placeholderContentFit="cover"
            contentFit="cover"
            cachePolicy="memory-disk"
            priority="high"
            transition={0}
            style={StyleSheet.absoluteFill}
        />
    ) : (
        fallback
    );

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
            {edgeFade > 0 ? (
                <MaskedView
                    style={StyleSheet.absoluteFill}
                    maskElement={
                        <LinearGradient
                            style={StyleSheet.absoluteFill}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            colors={[
                                "transparent",
                                "#000000",
                                "#000000",
                                "transparent",
                            ]}
                            locations={[0, edgeFade, 1 - edgeFade, 1]}
                        />
                    }
                >
                    {content}
                </MaskedView>
            ) : (
                content
            )}
        </MaskedView>
    );
}

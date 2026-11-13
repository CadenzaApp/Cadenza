import { Image } from "expo-image";
import { useState, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { cn, isUsableArtworkUrl } from "@/lib/utils";

/**
 * Remote artwork, cached in memory and on disk. `className` and `style` size
 * and round the box, which clips the image. `fallback` shows, centered, when
 * there is no usable url or the image fails to load.
 */
export function RemoteArtwork({
    url,
    className,
    style,
    fallback,
}: {
    url?: string | null;
    className?: string;
    style?: StyleProp<ViewStyle>;
    fallback?: ReactNode;
}) {
    // the url that failed, not a flag: a recycled list row gets a new url,
    // and a failed cover must not carry over to it
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const uri = url?.trim();
    const showImage = isUsableArtworkUrl(uri) && uri !== failedUrl;

    return (
        <View
            pointerEvents="none"
            className={cn(
                "items-center justify-center overflow-hidden bg-muted",
                className,
            )}
            style={style}
        >
            {showImage ? (
                <Image
                    source={{ uri }}
                    recyclingKey={uri}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={120}
                    onError={() => setFailedUrl(uri!)}
                />
            ) : (
                fallback
            )}
        </View>
    );
}

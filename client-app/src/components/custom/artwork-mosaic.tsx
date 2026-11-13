import Ionicons from "@expo/vector-icons/Ionicons";
import { View, type ColorValue } from "react-native";

import { RemoteArtwork } from "@/components/ui/remote-artwork";
import { cn } from "@/lib/utils";

/**
 * A square cover from up to four artworks: one fills it, more make a 2x2 grid
 * with a note glyph in any empty cell. The cover of query results and saved
 * queries.
 */
export function ArtworkMosaic({
    artworkUrls,
    size,
    placeholderColor,
    className = "rounded-2xl",
}: {
    artworkUrls: readonly string[];
    size: number;
    placeholderColor: ColorValue;
    /** The corner rounding. */
    className?: string;
}) {
    const oneArtwork = artworkUrls.length === 1 ? artworkUrls[0] : null;
    const cell = size / 2;
    const glyph = (
        <Ionicons
            name="musical-notes"
            size={Math.round(cell / 4)}
            color={placeholderColor}
            style={{ opacity: 0.45 }}
        />
    );

    if (oneArtwork) {
        return (
            <RemoteArtwork
                url={oneArtwork}
                className={className}
                style={{ width: size, height: size }}
                fallback={glyph}
            />
        );
    }

    return (
        <View
            className={cn(
                "flex-row flex-wrap overflow-hidden bg-muted",
                className,
            )}
            style={{ width: size, height: size }}
        >
            {Array.from({ length: 4 }, (_, index) => (
                <RemoteArtwork
                    key={index}
                    url={artworkUrls[index]}
                    style={{ width: cell, height: cell }}
                    fallback={glyph}
                />
            ))}
        </View>
    );
}

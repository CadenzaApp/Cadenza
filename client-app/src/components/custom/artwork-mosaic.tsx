import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, View, type ColorValue } from "react-native";

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

    if (oneArtwork) {
        return (
            <Image
                source={{ uri: oneArtwork }}
                className={cn("bg-muted", className)}
                style={{ width: size, height: size }}
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
            {Array.from({ length: 4 }, (_, index) => {
                const url = artworkUrls[index];
                return url ? (
                    <Image
                        key={`${url}:${index}`}
                        source={{ uri: url }}
                        className="bg-muted"
                        style={{ width: cell, height: cell }}
                    />
                ) : (
                    <View
                        key={index}
                        className="items-center justify-center bg-muted"
                        style={{ width: cell, height: cell }}
                    >
                        <Ionicons
                            name="musical-notes"
                            size={Math.round(cell / 4)}
                            color={placeholderColor}
                            style={{ opacity: 0.45 }}
                        />
                    </View>
                );
            })}
        </View>
    );
}

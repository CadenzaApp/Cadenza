import type { ArtistItem } from "@apple-musickit";
import { View } from "react-native";

import { ArtistRail } from "@/components/custom/artist-list";
import { Text } from "@/components/ui/text";

type Props = {
    artists: ArtistItem[];
    isLoading: boolean;
    onSelect: (artist: ArtistItem) => void;
};

/**
 * The Artists section above the search results. Renders nothing at all when
 * the term matched no artists, so a songs-only result set looks exactly as it
 * did before artists existed.
 */
export function SearchArtists({ artists, isLoading, onSelect }: Props) {
    if (!isLoading && artists.length === 0) return null;

    return (
        <View className="pb-4">
            <Text className="px-6 pb-3 text-xl font-bold text-foreground">
                Artists
            </Text>
            <ArtistRail
                artists={artists}
                isLoading={isLoading}
                onSelect={onSelect}
            />
        </View>
    );
}

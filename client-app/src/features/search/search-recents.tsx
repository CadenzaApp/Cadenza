import { View } from "react-native";
import Animated from "react-native-reanimated";

import { Text } from "@/components/ui/text";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";

import type { RecentSearch } from "./recent-searches";
import { RecentSearchesSection } from "./recent-searches-section";

type Props = {
    recents: RecentSearch[];
    onSelectQuery: (text: string) => void;
    onSelectSong: (entry: Extract<RecentSearch, { kind: "song" }>) => void;
    onRemoveRecent: (id: string) => void;
    onClearRecents: () => void;
};

/**
 * The focused search screen with nothing typed yet: what you searched and
 * opened before. Not wired to `useScreenScroll`, because docking the player
 * while the keyboard is up would move the thing you are typing into.
 */
export function SearchRecents({
    recents,
    onSelectQuery,
    onSelectSong,
    onRemoveRecent,
    onClearRecents,
}: Props) {
    const { listBottomInset } = useScreenOverlayInsets();

    if (recents.length === 0) {
        return (
            <View className="flex-1 items-center justify-center px-10 pb-24">
                <Text className="text-center text-muted-foreground">
                    Search for artists, songs, lyrics, and more.
                </Text>
            </View>
        );
    }

    return (
        <Animated.ScrollView
            className="flex-1"
            contentContainerStyle={{ paddingBottom: listBottomInset }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
        >
            <RecentSearchesSection
                recents={recents}
                onSelectQuery={onSelectQuery}
                onSelectSong={onSelectSong}
                onRemove={onRemoveRecent}
                onClear={onClearRecents}
            />
        </Animated.ScrollView>
    );
}

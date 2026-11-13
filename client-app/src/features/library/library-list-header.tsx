import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { View } from "react-native";

import { SearchField } from "@/components/custom/search-field";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useAppTheme } from "@/lib/theme";

/** How long typing has to pause before a search runs. */
const SEARCH_DEBOUNCE_MS = 300;

export type LibraryListSearch = {
    /** What is in the field, for the field. */
    text: string;
    setText: (text: string) => void;
    /** The settled term to search for, or null when the field is blank. */
    term: string | null;
};

/**
 * The search field's state. `term` trails `text` by a short pause, so a
 * search runs once typing stops rather than once per letter.
 */
export function useLibraryListSearch(): LibraryListSearch {
    const [text, setText] = useState("");
    const settled = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
    // clearing the field shows the whole list at once, with no pause
    const term = text.trim() && settled ? settled : null;
    return { text, setText, term };
}

export type LibraryListPlayActions = {
    onPlay: () => void | Promise<void>;
    onShuffle: () => void | Promise<void>;
    /** Nothing to play yet. */
    disabled: boolean;
    /** A queue is resolving. Both buttons wait for it. */
    pending: boolean;
};

/**
 * The top of a library category list, the way Apple Music lays it out: a
 * search field, then Play and Shuffle for the lists that can be played. Goes
 * in the list as its header, so it scrolls with the rows.
 */
export function LibraryListHeader({
    search,
    placeholder,
    actions,
}: {
    search: LibraryListSearch;
    placeholder: string;
    /** Omitted for a list with nothing to play, like Artists. */
    actions?: LibraryListPlayActions;
}) {
    return (
        <View className="gap-4 px-5 pb-3 pt-1">
            <View className="flex-row">
                <SearchField
                    value={search.text}
                    onChangeText={search.setText}
                    onSubmit={() => {}}
                    onClear={() => search.setText("")}
                    placeholder={placeholder}
                />
            </View>
            {actions ? <PlayShuffleRow {...actions} /> : null}
        </View>
    );
}

function PlayShuffleRow({
    onPlay,
    onShuffle,
    disabled,
    pending,
}: LibraryListPlayActions) {
    const { brand } = useAppTheme().colors;
    const run = (command: () => void | Promise<void>) => {
        void Promise.resolve(command()).catch(() => {
            // the playback provider owns the user facing error
        });
    };

    return (
        <View className="flex-row gap-3">
            <Button
                variant="secondary"
                className="h-12 flex-1 rounded-xl"
                disabled={disabled || pending}
                onPress={() => run(onPlay)}
                accessibilityLabel="Play all"
            >
                <Ionicons name="play" size={20} color={brand} />
                <Text className="font-semibold" style={{ color: brand }}>
                    Play
                </Text>
            </Button>
            <Button
                variant="secondary"
                className="h-12 flex-1 rounded-xl"
                disabled={disabled || pending}
                onPress={() => run(onShuffle)}
                accessibilityLabel="Shuffle all"
            >
                <Ionicons name="shuffle" size={20} color={brand} />
                <Text className="font-semibold" style={{ color: brand }}>
                    Shuffle
                </Text>
            </Button>
        </View>
    );
}

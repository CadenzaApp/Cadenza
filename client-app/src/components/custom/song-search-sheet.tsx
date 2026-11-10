import Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem } from "@apple-musickit";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Image,
    Pressable,
    ScrollView,
    View,
} from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { GlassInput } from "@/components/ui/glass-input";
import { Text } from "@/components/ui/text";
import { useCatalogSongSearch } from "@/lib/musickit-hooks";
import { useAppTheme } from "@/lib/theme";
import { isUsableArtworkUrl } from "@/lib/utils";

const SEARCH_DEBOUNCE_MS = 350;
const MIN_SEARCH_LENGTH = 2;
const RESULT_LIMIT = 25;

/**
 * Searches the Apple Music catalog and hands back each song tapped. Stays open
 * so several can be added; tapped songs show a check. Catalog songs only, so
 * everything picked can be shared with other people.
 *
 * `actionLabel` names what a tap does, like "Add" or "Suggest".
 */
export function SongSearchSheet({
    title,
    actionLabel,
    onPick,
    onClose,
}: {
    title: string;
    actionLabel: string;
    onPick: (song: MusicItem) => void | Promise<void>;
    onClose: () => void;
}) {
    const { colors } = useAppTheme();
    const search = useCatalogSongSearch(true);
    const [term, setTerm] = useState("");
    const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

    useEffect(() => {
        const trimmed = term.trim();
        const timer = setTimeout(
            () => {
                if (trimmed.length < MIN_SEARCH_LENGTH) {
                    search.clearSearchCatalog();
                } else {
                    search.searchCatalog(trimmed);
                }
            },
            trimmed.length < MIN_SEARCH_LENGTH ? 0 : SEARCH_DEBOUNCE_MS,
        );
        return () => clearTimeout(timer);
        // searchCatalog is recreated each render; the term is the real input
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [term]);

    const results = search.searchResults.slice(0, RESULT_LIMIT);

    async function pick(song: MusicItem) {
        const id = song.catalogId ?? song.id;
        if (picked.has(id)) return;
        setPicked((current) => new Set(current).add(id));
        try {
            await onPick(song);
        } catch {
            setPicked((current) => {
                const next = new Set(current);
                next.delete(id);
                return next;
            });
        }
    }

    return (
        <ModalPopup visible keyboardAware onClose={onClose} title={title}>
            <View className="gap-3 px-1 pb-1">
                <GlassInput
                    icon="search"
                    placeholder="Search Apple Music"
                    value={term}
                    onChangeText={setTerm}
                    autoFocus
                    autoCorrect={false}
                    returnKeyType="search"
                />
                <ScrollView
                    style={{ maxHeight: 380 }}
                    keyboardShouldPersistTaps="handled"
                >
                    {search.searchCatalogLoading && term.trim() ? (
                        <ActivityIndicator
                            className="py-6"
                            color={colors.foreground}
                        />
                    ) : results.length === 0 ? (
                        <Text className="py-6 text-center text-sm text-muted-foreground">
                            {term.trim().length < MIN_SEARCH_LENGTH
                                ? "Search for a song."
                                : "No songs found."}
                        </Text>
                    ) : (
                        results.map((song) => (
                            <ResultRow
                                key={song.id}
                                song={song}
                                actionLabel={actionLabel}
                                picked={picked.has(song.catalogId ?? song.id)}
                                onPress={() => void pick(song)}
                            />
                        ))
                    )}
                </ScrollView>
            </View>
        </ModalPopup>
    );
}

function ResultRow({
    song,
    actionLabel,
    picked,
    onPress,
}: {
    song: MusicItem;
    actionLabel: string;
    picked: boolean;
    onPress: () => void;
}) {
    const { colors } = useAppTheme();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${actionLabel} ${song.title}`}
            accessibilityState={{ selected: picked }}
            onPress={onPress}
            className="flex-row items-center gap-3 px-2 py-2 active:opacity-60"
        >
            {isUsableArtworkUrl(song.artworkUrl) ? (
                <Image
                    source={{ uri: song.artworkUrl }}
                    className="rounded-md bg-muted"
                    style={{ width: 40, height: 40 }}
                />
            ) : (
                <View
                    className="items-center justify-center rounded-md bg-muted"
                    style={{ width: 40, height: 40 }}
                >
                    <Ionicons
                        name="musical-notes"
                        size={16}
                        color={colors.mutedForeground}
                    />
                </View>
            )}
            <View className="min-w-0 flex-1">
                <Text
                    className="text-sm font-medium text-foreground"
                    numberOfLines={1}
                >
                    {song.title}
                </Text>
                {song.artistName ? (
                    <Text
                        className="text-xs text-muted-foreground"
                        numberOfLines={1}
                    >
                        {song.artistName}
                    </Text>
                ) : null}
            </View>
            <Ionicons
                name={picked ? "checkmark-circle" : "add-circle-outline"}
                size={24}
                color={picked ? colors.brand : colors.mutedForeground}
            />
        </Pressable>
    );
}

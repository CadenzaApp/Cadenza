import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import type { ReactNode } from "react";
import { Image, Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";

import type { RecentSearch } from "./recent-searches";

type Props = {
    recents: RecentSearch[];
    /** Re-runs a past query. */
    onSelectQuery: (text: string) => void;
    /** Plays a song the user opened before. */
    onSelectSong: (entry: Extract<RecentSearch, { kind: "song" }>) => void;
    onRemove: (id: string) => void;
    onClear: () => void;
};

/**
 * What the user searched and opened before. A purpose-built list rather than
 * `MusicList`: half the rows are plain text, none of them are a full
 * `MusicItem`, and tagging or multi-select would mean nothing here.
 */
export function RecentSearchesSection({
    recents,
    onSelectQuery,
    onSelectSong,
    onRemove,
    onClear,
}: Props) {
    if (recents.length === 0) return null;

    return (
        <View>
            <View className="flex-row items-center justify-between px-5 pb-1 pt-2">
                <Text className="text-lg font-bold">Recently Searched</Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear recent searches"
                    onPress={onClear}
                    hitSlop={8}
                    className="active:opacity-60"
                >
                    <Text className="text-sm font-medium text-primary">
                        Clear
                    </Text>
                </Pressable>
            </View>

            {recents.map((entry) =>
                entry.kind === "query" ? (
                    <RecentRow
                        key={entry.id}
                        label={entry.text}
                        accessibilityLabel={`Search again for ${entry.text}`}
                        onPress={() => onSelectQuery(entry.text)}
                        onRemove={() => onRemove(entry.id)}
                        leading={<QueryGlyph />}
                    />
                ) : (
                    <RecentRow
                        key={entry.id}
                        label={entry.title}
                        subtitle={
                            entry.artistName
                                ? `Song \u00b7 ${entry.artistName}`
                                : "Song"
                        }
                        accessibilityLabel={`Play ${entry.title}`}
                        onPress={() => onSelectSong(entry)}
                        onRemove={() => onRemove(entry.id)}
                        leading={<SongArtwork url={entry.artworkUrl} />}
                    />
                ),
            )}
        </View>
    );
}

function RecentRow({
    label,
    subtitle,
    accessibilityLabel,
    onPress,
    onRemove,
    leading,
}: {
    label: string;
    subtitle?: string;
    accessibilityLabel: string;
    onPress: () => void;
    onRemove: () => void;
    leading: ReactNode;
}) {
    const { colors } = useTheme();

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            onPress={onPress}
            className="relative flex-row items-center px-5 py-2.5 active:opacity-80"
        >
            <View className="absolute bottom-0 left-5 right-5 border-b border-border" />

            {leading}

            <View className="flex-1 overflow-hidden">
                <Text
                    className="text-base text-foreground leading-tight"
                    numberOfLines={1}
                >
                    {label}
                </Text>
                {subtitle ? (
                    <Text
                        className="mt-0.5 text-sm text-muted-foreground leading-tight"
                        numberOfLines={1}
                    >
                        {subtitle}
                    </Text>
                ) : null}
            </View>

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${label} from recent searches`}
                onPress={onRemove}
                hitSlop={10}
                className="ml-3 p-1 active:opacity-60"
            >
                <Ionicons name="close" size={18} color={colors.text} />
            </Pressable>
        </Pressable>
    );
}

function QueryGlyph() {
    const { colors } = useTheme();

    return (
        <View className="mr-3 h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted">
            <Ionicons name="search" size={18} color={colors.text} />
        </View>
    );
}

function SongArtwork({ url }: { url?: string }) {
    const artworkUrl = url?.trim();
    const canRenderArtwork =
        typeof artworkUrl === "string" && /^https?:\/\//i.test(artworkUrl);

    if (!canRenderArtwork) {
        return (
            <View className="mr-3 h-11 w-11 shrink-0 aspect-square items-center justify-center rounded bg-muted">
                <Text className="text-center text-xs text-muted-foreground">
                    No Art
                </Text>
            </View>
        );
    }

    return (
        <Image
            source={{ uri: artworkUrl }}
            className="mr-3 h-11 w-11 shrink-0 aspect-square rounded bg-muted"
        />
    );
}

import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { FlatList, Pressable, View } from "react-native";
import Animated from "react-native-reanimated";

import { ArtworkMosaic } from "@/components/custom/artwork-mosaic";
import { ErrorNotice } from "@/components/custom/error-notice";
import { MusicListItemSkeleton } from "@/components/custom/music-list/music-list-item";
import { NewOrJoinRow } from "@/components/custom/new-or-join-row";
import { Text } from "@/components/ui/text";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";

import {
    LibraryListHeader,
    type LibraryListPlayActions,
    type LibraryListSearch,
} from "./library-list-header";

const SKELETON_ROW_COUNT = 6;
const ROW_ARTWORK_SIZE = 56;

/**
 * A Library list of the user's own things, like saved queries or shared
 * playlists, as a screen's scroller. Top to bottom: `above` (a view switch),
 * search, Play and Shuffle when `actions` is set, New (and Enter code with
 * `create.joinWithCode`) when `create` is set, then the rows. Only what the rows show differs.
 */
export function LibraryList<Item>({
    items,
    keyOf,
    renderItem,
    isLoading,
    error,
    emptyLabel,
    above,
    search,
    placeholder,
    create,
    actions,
}: {
    items: readonly Item[];
    keyOf: (item: Item) => string;
    renderItem: (item: Item) => ReactElement;
    /** First load, before there are rows. */
    isLoading: boolean;
    error?: unknown;
    emptyLabel: string;
    above?: ReactNode;
    search: LibraryListSearch;
    placeholder: string;
    /** The New pill's label and what it does, and whether Enter code joins it. */
    create?: { label: string; onPress: () => void; joinWithCode?: boolean };
    actions?: LibraryListPlayActions;
}) {
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll<FlatList<Item>>();

    return (
        <ScreenScrollMarker>
            <Animated.FlatList
                {...scroll}
                className="flex-1"
                data={items}
                keyExtractor={keyOf}
                renderItem={({ item }) => renderItem(item)}
                contentContainerStyle={[
                    { paddingBottom: listBottomInset },
                    scroll.contentContainerStyle,
                ]}
                ListHeaderComponent={
                    <>
                        {error ? <ErrorNotice error={error} /> : null}
                        {above ? (
                            <View className="px-5 pb-2">{above}</View>
                        ) : null}
                        <LibraryListHeader
                            search={search}
                            placeholder={placeholder}
                            below={
                                create ? (
                                    <NewOrJoinRow
                                        newLabel={create.label}
                                        onNew={create.onPress}
                                        joinWithCode={create.joinWithCode}
                                    />
                                ) : null
                            }
                            actions={actions}
                        />
                    </>
                }
                ListEmptyComponent={
                    isLoading ? (
                        <View>
                            {Array.from(
                                { length: SKELETON_ROW_COUNT },
                                (_, index) => (
                                    <MusicListItemSkeleton
                                        key={index}
                                        fullBleed
                                    />
                                ),
                            )}
                        </View>
                    ) : (
                        <Text className="px-6 py-10 text-center text-muted-foreground">
                            {emptyLabel}
                        </Text>
                    )
                }
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            />
        </ScreenScrollMarker>
    );
}

/**
 * One `LibraryList` row: a cover, or `fallbackIcon` without one, a title and
 * a line under it. `badge` sits before the title, `trailing` at the end.
 */
export function LibraryListRow({
    title,
    subtitle,
    artworkUrls,
    fallbackIcon,
    accessibilityLabel,
    onPress,
    badge,
    trailing,
}: {
    title: string;
    subtitle: string;
    artworkUrls: string[];
    fallbackIcon: ComponentProps<typeof Ionicons>["name"];
    accessibilityLabel: string;
    onPress: () => void;
    badge?: ReactNode;
    trailing?: ReactNode;
}) {
    const { colors } = useTheme();

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            onPress={onPress}
            className="relative flex-row items-center px-6 py-3 active:opacity-80"
        >
            <View className="absolute bottom-0 left-6 right-6 border-b border-border" />
            <View className="mr-3">
                {artworkUrls.length > 0 ? (
                    <ArtworkMosaic
                        artworkUrls={artworkUrls}
                        size={ROW_ARTWORK_SIZE}
                        placeholderColor={colors.text}
                        className="rounded"
                    />
                ) : (
                    <View
                        className="items-center justify-center rounded bg-muted"
                        style={{
                            width: ROW_ARTWORK_SIZE,
                            height: ROW_ARTWORK_SIZE,
                        }}
                    >
                        <Ionicons
                            name={fallbackIcon}
                            size={22}
                            color={colors.text}
                        />
                    </View>
                )}
            </View>
            <View className="flex-1 overflow-hidden">
                <View className="flex-row items-center gap-1">
                    {badge}
                    <Text
                        className="shrink text-base font-bold leading-tight text-foreground"
                        numberOfLines={1}
                    >
                        {title}
                    </Text>
                </View>
                <Text
                    className="mt-0.5 text-sm leading-tight text-muted-foreground"
                    numberOfLines={1}
                >
                    {subtitle}
                </Text>
            </View>
            {trailing}
        </Pressable>
    );
}

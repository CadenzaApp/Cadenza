import Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem } from "@apple-musickit";
import { useTheme } from "expo-router/react-navigation";
import type { ComponentProps, ReactNode } from "react";
import { useMemo, useState } from "react";
import {
    Image,
    View,
    type ColorValue,
    type StyleProp,
    type ViewStyle,
} from "react-native";
import Animated, {
    Extrapolation,
    interpolate,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
} from "react-native-reanimated";

import {
    MusicList,
    type MusicListMultiSelectConfig,
    type MusicListPagination,
    type MusicListSorting,
} from "@/components/custom/music-list";
import { ModalPopup } from "@/components/custom/modal-popup";
import { Button } from "@/components/ui/button";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
import { usePlaybackCommands } from "@/lib/playback";

import {
    collectionArtworkGrid,
    formatTrackCollectionSummary,
} from "./track-collection-utils";

const ARTWORK_SIZE = 224;
const ARTWORK_SCROLL_SCALE_DISTANCE = 120;

export type TrackCollectionOption = {
    id: string;
    label: string;
    icon: ComponentProps<typeof Ionicons>["name"];
    onPress: () => void | Promise<void>;
};

export type { MusicListMultiSelectConfig } from "@/components/custom/music-list";

type Props = {
    title: string;
    tracks: MusicItem[];
    isLoading: boolean;
    error?: unknown;
    anticipatedTrackCount?: number;
    onBackPress?: () => void;
    closeControl?: ReactNode;
    options?: readonly TrackCollectionOption[];
    multiSelect?: MusicListMultiSelectConfig | null;
    showTags?: boolean;
    artworkUrls?: readonly string[];
    subtitle?: string;
    summary?: string;
    header?: ReactNode;
    footer?: ReactNode;
    background?: ReactNode;
    containerStyle?: StyleProp<ViewStyle>;
    pagination?: MusicListPagination | null;
    sorting?: MusicListSorting | null;
    onContentSizeChange?: (width: number, height: number) => void;
    onPlay?: () => void | Promise<void>;
    onShuffle?: () => void | Promise<void>;
    isPlaying?: boolean;
};

/** Reusable artwork, actions, metadata, and track-list surface for a collection. */
export function TrackCollectionView({
    title,
    tracks,
    isLoading,
    error,
    anticipatedTrackCount,
    onBackPress,
    options = [],
    multiSelect = null,
    showTags = true,
    artworkUrls: artworkUrlsOverride,
    subtitle,
    summary: summaryOverride,
    header,
    footer,
    background,
    containerStyle,
    pagination = null,
    sorting = {
        strategy: "local",
        defaultValue: { option: "title", direction: "ascending" },
    },
    onContentSizeChange,
    onPlay,
    onShuffle,
    isPlaying = false,
    closeControl,
}: Props) {
    const { colors } = useTheme();
    const { playQueue } = usePlaybackCommands();
    const [optionsOpen, setOptionsOpen] = useState(false);
    const scrollY = useSharedValue(0);
    const derivedArtworkUrls = useMemo(
        () => collectionArtworkGrid(tracks),
        [tracks],
    );
    const artworkUrls = artworkUrlsOverride ?? derivedArtworkUrls;
    const summary = useMemo(
        () => summaryOverride ?? formatTrackCollectionSummary(tracks),
        [summaryOverride, tracks],
    );
    const actionsDisabled = tracks.length === 0 || isLoading;
    const onScroll = useAnimatedScrollHandler((event) => {
        scrollY.set(Math.max(0, event.contentOffset.y));
    });
    const artworkStyle = useAnimatedStyle(() => ({
        transformOrigin: "center bottom",
        transform: [
            {
                scale: interpolate(
                    scrollY.get(),
                    [0, ARTWORK_SCROLL_SCALE_DISTANCE],
                    [1, 0.8],
                    Extrapolation.CLAMP,
                ),
            },
        ],
    }));

    function playAll() {
        const command = onPlay ? onPlay() : playQueue({ tracks });
        void Promise.resolve(command).catch(() => {
            // The playback provider owns the user-facing error.
        });
    }

    function shuffleAll() {
        if (onShuffle) {
            void Promise.resolve(onShuffle()).catch(() => {
                // The caller owns the user-facing error.
            });
            return;
        }
        const shuffled = [...tracks];
        for (let index = shuffled.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [shuffled[index], shuffled[swapIndex]] = [
                shuffled[swapIndex],
                shuffled[index],
            ];
        }
        void playQueue({ tracks: shuffled }).catch(() => {
            // The playback provider owns the user-facing error.
        });
    }

    function runOption(option: TrackCollectionOption) {
        setOptionsOpen(false);
        void Promise.resolve(option.onPress()).catch((optionError) => {
            console.error(
                `Collection option ${option.id} failed:`,
                optionError,
            );
        });
    }

    const defaultHeader = (
        <View className="relative px-4 pb-4 pt-8">
            {background}
            <View className="items-center">
                <Animated.View style={artworkStyle}>
                    <ArtworkMosaic
                        artworkUrls={artworkUrls}
                        placeholderColor={colors.text}
                    />
                </Animated.View>
                <Text className="mt-4 text-center text-2xl font-bold">
                    {title}
                </Text>
                {subtitle ? (
                    <Text className="mt-1 text-center text-base text-muted-foreground">
                        {subtitle}
                    </Text>
                ) : null}
                <Text className="mt-1 text-sm text-muted-foreground">
                    {summary}
                </Text>
            </View>

            <View className="mt-4 flex-row items-center gap-2.5">
                <Button
                    className="h-12 flex-1 rounded-xl"
                    disabled={actionsDisabled}
                    onPress={playAll}
                    accessibilityLabel={`Play ${title}`}
                >
                    <Ionicons
                        name={isPlaying ? "pause" : "play"}
                        size={25}
                        color={colors.background}
                    />
                    <Text className="font-semibold">
                        {isPlaying ? "Pause" : "Play"}
                    </Text>
                </Button>
                <Button
                    variant="secondary"
                    className="h-12 flex-1 rounded-xl"
                    disabled={actionsDisabled}
                    onPress={shuffleAll}
                    accessibilityLabel={`Shuffle ${title}`}
                >
                    <Ionicons name="shuffle" size={25} color={colors.text} />
                    <Text className="font-semibold">Shuffle</Text>
                </Button>
                {options.length === 1 ? (
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-11 w-11 rounded-full"
                        onPress={() => runOption(options[0])}
                        accessibilityLabel={options[0].label}
                    >
                        <Ionicons
                            name={options[0].icon}
                            size={20}
                            color={colors.text}
                        />
                    </Button>
                ) : options.length > 1 ? (
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-11 w-11 rounded-full"
                        onPress={() => setOptionsOpen(true)}
                        accessibilityLabel={`More options for ${title}`}
                        accessibilityState={{ expanded: optionsOpen }}
                    >
                        <Ionicons
                            name="ellipsis-vertical"
                            size={20}
                            color={colors.text}
                        />
                    </Button>
                ) : null}
            </View>

            {error ? (
                <Text className="mt-3 text-center text-destructive">
                    Failed to load tracks.
                </Text>
            ) : null}
        </View>
    );

    return (
        <View className="flex-1 bg-background" style={containerStyle}>
            <MusicList
                tracks={tracks}
                isLoading={isLoading}
                pagination={pagination}
                sorting={sorting}
                anticipatedTrackCount={anticipatedTrackCount}
                header={header ?? defaultHeader}
                footer={footer}
                onContentSizeChange={onContentSizeChange}
                onScroll={header ? undefined : onScroll}
                multiSelect={multiSelect}
                showTags={showTags}
                fullBleedRows
            />

            {closeControl ??
                (onBackPress ? (
                    <View className="absolute left-4 top-3 z-20">
                        <GlassIconButton
                            size={48}
                            onPress={onBackPress}
                            accessibilityLabel="Back"
                            style={{
                                shadowColor: "#000",
                                shadowOpacity: 0.18,
                                shadowRadius: 9,
                                shadowOffset: { width: 0, height: 3 },
                                elevation: 8,
                            }}
                        >
                            <Ionicons
                                name="chevron-back"
                                size={28}
                                color={colors.text}
                            />
                        </GlassIconButton>
                    </View>
                ) : null)}

            <ModalPopup
                visible={optionsOpen}
                onClose={() => setOptionsOpen(false)}
                title="Options"
                variant="glass"
            >
                {options.map((option) => (
                    <Button
                        key={option.id}
                        variant="ghost"
                        className="w-full justify-start rounded-lg"
                        onPress={() => runOption(option)}
                    >
                        <Ionicons
                            name={option.icon}
                            size={19}
                            color={colors.text}
                        />
                        <Text>{option.label}</Text>
                    </Button>
                ))}
            </ModalPopup>
        </View>
    );
}

function ArtworkMosaic({
    artworkUrls,
    placeholderColor,
}: {
    artworkUrls: readonly string[];
    placeholderColor: ColorValue;
}) {
    const oneArtwork = artworkUrls.length === 1 ? artworkUrls[0] : null;

    if (oneArtwork) {
        return (
            <Image
                source={{ uri: oneArtwork }}
                className="rounded-2xl bg-muted"
                style={{ width: ARTWORK_SIZE, height: ARTWORK_SIZE }}
            />
        );
    }

    return (
        <View
            className="flex-row flex-wrap overflow-hidden rounded-2xl bg-muted"
            style={{ width: ARTWORK_SIZE, height: ARTWORK_SIZE }}
        >
            {Array.from({ length: 4 }, (_, index) => {
                const url = artworkUrls[index];
                return url ? (
                    <Image
                        key={`${url}:${index}`}
                        source={{ uri: url }}
                        className="bg-muted"
                        style={{
                            width: ARTWORK_SIZE / 2,
                            height: ARTWORK_SIZE / 2,
                        }}
                    />
                ) : (
                    <View
                        key={index}
                        className="items-center justify-center bg-muted"
                        style={{
                            width: ARTWORK_SIZE / 2,
                            height: ARTWORK_SIZE / 2,
                        }}
                    >
                        <Ionicons
                            name="musical-notes"
                            size={30}
                            color={placeholderColor}
                            style={{ opacity: 0.45 }}
                        />
                    </View>
                );
            })}
        </View>
    );
}

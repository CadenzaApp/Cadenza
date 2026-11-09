import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { memo } from "react";
import { Pressable } from "react-native";

import { Text } from "@/components/ui/text";

import type { MusicListSection } from "./types";

/** A group header's height, fixed so the list can size its rows. */
export const MUSIC_LIST_SECTION_HEADER_HEIGHT = 52;

type RowProps = {
    section: MusicListSection;
    fullBleed: boolean;
    fullBleedHorizontalPadding: number;
};

/**
 * One group's header in a grouped list: its value and how many songs it
 * holds. Tapping it opens or closes the group.
 */
export const MusicListSectionHeader = memo(function MusicListSectionHeader({
    section,
    fullBleed,
    fullBleedHorizontalPadding,
    onToggle,
}: RowProps & { onToggle: (key: string) => void }) {
    const { colors } = useTheme();
    const songs = `${section.count} ${section.count === 1 ? "song" : "songs"}`;

    return (
        <Pressable
            onPress={() => onToggle(section.key)}
            accessibilityRole="button"
            accessibilityLabel={`${section.label}, ${songs}`}
            accessibilityState={{ expanded: section.expanded }}
            className="flex-row items-center gap-3 active:opacity-70"
            style={{
                height: MUSIC_LIST_SECTION_HEADER_HEIGHT,
                paddingHorizontal: fullBleed ? fullBleedHorizontalPadding : 0,
            }}
        >
            <Ionicons
                name={section.expanded ? "chevron-down" : "chevron-forward"}
                size={18}
                color={colors.text}
            />
            <Text className="flex-1 text-base font-semibold" numberOfLines={1}>
                {section.label}
            </Text>
            <Text className="text-sm text-muted-foreground">{songs}</Text>
        </Pressable>
    );
});

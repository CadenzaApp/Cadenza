import { useTheme } from "expo-router/react-navigation";
import { memo } from "react";
import { Pressable } from "react-native";

import {
    ContrastIcon,
    ContrastRegion,
    ContrastText as Text,
} from "@/lib/surface-contrast-context";

import type { MusicListSection } from "./types";

/** A group header's height, fixed so a tinted page knows where each row sits. */
export const MUSIC_LIST_SECTION_HEADER_HEIGHT = 52;

type RowProps = {
    section: MusicListSection;
    fullBleed: boolean;
    fullBleedHorizontalPadding: number;
    /** Where the row's middle sits in the scroll content; see `ContrastRegion`. */
    surfaceOffset: number;
};

/**
 * One group's header in a grouped list: its value and how many songs it
 * holds. Tapping it opens or closes the group.
 */
export const MusicListSectionHeader = memo(function MusicListSectionHeader({
    section,
    fullBleed,
    fullBleedHorizontalPadding,
    surfaceOffset,
    onToggle,
}: RowProps & { onToggle: (key: string) => void }) {
    const { colors } = useTheme();
    const songs = `${section.count} ${section.count === 1 ? "song" : "songs"}`;

    return (
        <ContrastRegion offset={surfaceOffset}>
            <Pressable
                onPress={() => onToggle(section.key)}
                accessibilityRole="button"
                accessibilityLabel={`${section.label}, ${songs}`}
                accessibilityState={{ expanded: section.expanded }}
                className="flex-row items-center gap-3 active:opacity-70"
                style={{
                    height: MUSIC_LIST_SECTION_HEADER_HEIGHT,
                    paddingHorizontal: fullBleed
                        ? fullBleedHorizontalPadding
                        : 0,
                }}
            >
                <ContrastIcon
                    name={section.expanded ? "chevron-down" : "chevron-forward"}
                    size={18}
                    color={colors.text}
                />
                <Text
                    className="flex-1 text-base font-semibold"
                    numberOfLines={1}
                >
                    {section.label}
                </Text>
                <Text className="text-sm text-muted-foreground">{songs}</Text>
            </Pressable>
        </ContrastRegion>
    );
});

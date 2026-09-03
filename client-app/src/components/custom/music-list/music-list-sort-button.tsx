import { Funnel, ArrowDown, ArrowUp } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, useWindowDimensions } from "react-native";
import { useTheme } from "expo-router/react-navigation";

import { FloatingBubble } from "@/components/custom/floating-bubble";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";

import { MUSIC_LIST_SORT_LABELS, nextSort } from "./sort-tracks";
import type { MusicListSort, MusicListSortOption } from "./types";

type MusicListSortButtonProps = {
    sort: MusicListSort;
    options: readonly MusicListSortOption[];
    onSortChange: (sort: MusicListSort) => void;
};

export function MusicListSortButton({
    sort,
    options,
    onSortChange,
}: MusicListSortButtonProps) {
    const [isOpen, setIsOpen] = useState(false);
    const { colors } = useTheme();
    const { width: viewportWidth } = useWindowDimensions();
    const sortLabel = MUSIC_LIST_SORT_LABELS[sort.option];
    const DirectionIcon = sort.direction === "ascending" ? ArrowUp : ArrowDown;
    const popupWidth = Math.min(400, Math.max(240, viewportWidth * 0.7));

    function handleSelect(option: MusicListSortOption) {
        onSortChange(nextSort(sort, option));
    }

    return (
        <>
            <FloatingBubble
                onPress={() => setIsOpen(true)}
                accessibilityLabel={`Sort tracks by ${sortLabel}, ${sort.direction}`}
                accessibilityState={{ expanded: isOpen }}
            >
                <Funnel size={28} color={colors.background} />
            </FloatingBubble>

            <Modal
                visible={isOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setIsOpen(false)}
            >
                <Pressable
                    className="flex-1 items-center justify-center bg-black/70 px-4 py-8"
                    onPress={() => setIsOpen(false)}
                >
                    <Pressable
                        className="gap-2 rounded-lg border border-border bg-popover p-4 shadow-lg shadow-black/5"
                        style={{ width: popupWidth, maxWidth: popupWidth }}
                        onPress={(event) => event.stopPropagation()}
                    >
                        <Text className="text-lg font-semibold text-foreground">
                            Sort music
                        </Text>

                        {options.map((option) => {
                            const isSelected = sort.option === option;
                            const label = MUSIC_LIST_SORT_LABELS[option];

                            return (
                                <Button
                                    key={option}
                                    variant={isSelected ? "secondary" : "ghost"}
                                    className="w-full justify-start rounded-lg"
                                    onPress={() => handleSelect(option)}
                                    accessibilityLabel={
                                        isSelected
                                            ? `Sort by ${label}, toggle direction`
                                            : `Sort by ${label}`
                                    }
                                >
                                    <Text
                                        className="flex-1 pr-2"
                                        numberOfLines={1}
                                    >
                                        {label}
                                    </Text>
                                    {isSelected && (
                                        <Icon
                                            as={DirectionIcon}
                                            className="shrink-0"
                                            size={16}
                                        />
                                    )}
                                </Button>
                            );
                        })}
                    </Pressable>
                </Pressable>
            </Modal>
        </>
    );
}

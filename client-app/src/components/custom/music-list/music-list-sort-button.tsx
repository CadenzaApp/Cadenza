import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { useTheme } from "expo-router/react-navigation";

import { ScreenFloatingBubble } from "@/components/custom/floating-bubble";
import { ModalPopup } from "@/components/custom/modal-popup";
import { Button } from "@/components/ui/button";
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
    const sortLabel = MUSIC_LIST_SORT_LABELS[sort.option];
    const directionIcon =
        sort.direction === "ascending" ? "arrow-up" : "arrow-down";

    function handleSelect(option: MusicListSortOption) {
        onSortChange(nextSort(sort, option));
    }

    return (
        <>
            <ScreenFloatingBubble
                onPress={() => setIsOpen(true)}
                accessibilityLabel={`Sort tracks by ${sortLabel}, ${sort.direction}`}
                accessibilityState={{ expanded: isOpen }}
            >
                <Ionicons
                    name="funnel-outline"
                    size={28}
                    color={colors.background}
                />
            </ScreenFloatingBubble>

            <ModalPopup
                visible={isOpen}
                onClose={() => setIsOpen(false)}
                title="Sort music"
            >
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
                            <Text className="flex-1 pr-2" numberOfLines={1}>
                                {label}
                            </Text>
                            {isSelected ? (
                                <Ionicons
                                    name={directionIcon}
                                    size={16}
                                    color={colors.text}
                                />
                            ) : null}
                        </Button>
                    );
                })}
            </ModalPopup>
        </>
    );
}

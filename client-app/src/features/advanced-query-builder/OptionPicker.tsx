import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";

import { ModalPopup } from "@/components/custom/modal-popup";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

export type IconName = React.ComponentProps<typeof Ionicons>["name"];

export type PickerOption = {
    key: string;
    label: string;
    icon?: IconName;
    /** Defaults to the theme's text color. */
    iconColor?: string;
};

export type PickerSection = {
    title?: string;
    options: PickerOption[];
};

type Props = {
    visible: boolean;
    title: string;
    sections: PickerSection[];
    selectedKey?: string | null;
    /** Shows a filter box above the options. */
    searchable?: boolean;
    emptyText?: string;
    onSelect: (key: string) => void;
    onClose: () => void;
};

/** A popup list of choices, optionally grouped and searchable. */
export function OptionPicker({
    visible,
    title,
    sections,
    selectedKey,
    searchable,
    emptyText = "Nothing to choose from",
    onSelect,
    onClose,
}: Props) {
    const { colors } = useTheme();
    const [search, setSearch] = useState("");

    const needle = search.trim().toLowerCase();
    const visibleSections = sections
        .map((section) => ({
            ...section,
            options: section.options.filter((option) =>
                option.label.toLowerCase().includes(needle),
            ),
        }))
        .filter((section) => section.options.length > 0);

    function close() {
        setSearch("");
        onClose();
    }

    function select(key: string) {
        setSearch("");
        onSelect(key);
    }

    return (
        <ModalPopup
            visible={visible}
            onClose={close}
            title={title}
            contentStyle={{ width: "85%" }}
        >
            {searchable && (
                <Input
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search"
                    autoCorrect={false}
                    autoCapitalize="none"
                />
            )}

            <ScrollView
                className="max-h-[420px]"
                keyboardShouldPersistTaps="handled"
            >
                {visibleSections.length === 0 && (
                    <Text className="text-muted-foreground text-sm py-2">
                        {emptyText}
                    </Text>
                )}

                {visibleSections.map((section, sectionIndex) => (
                    <View key={section.title ?? sectionIndex} className="pb-2">
                        {section.title && (
                            <Text className="text-muted-foreground text-xs font-medium uppercase pt-2 pb-1">
                                {section.title}
                            </Text>
                        )}
                        {section.options.map((option) => {
                            const selected = option.key === selectedKey;
                            return (
                                <Pressable
                                    key={option.key}
                                    onPress={() => select(option.key)}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected }}
                                    className={cn(
                                        "flex-row items-center gap-3 rounded-md px-2 py-2.5 active:bg-accent",
                                        selected && "bg-accent",
                                    )}
                                >
                                    {option.icon && (
                                        <Ionicons
                                            name={option.icon}
                                            size={18}
                                            color={
                                                option.iconColor ?? colors.text
                                            }
                                        />
                                    )}
                                    <Text
                                        className="flex-1 text-base"
                                        numberOfLines={1}
                                    >
                                        {option.label}
                                    </Text>
                                    {selected && (
                                        <Ionicons
                                            name="checkmark"
                                            size={18}
                                            color={colors.text}
                                        />
                                    )}
                                </Pressable>
                            );
                        })}
                    </View>
                ))}
            </ScrollView>
        </ModalPopup>
    );
}

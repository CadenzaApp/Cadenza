import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { Text } from "@/components/ui/text";
import type { FilterOp } from "@/lib/query-json";
import { useAppTheme } from "@/lib/theme";
import type { Tag } from "@/lib/types";
import {
    filterValue,
    METADATA_FIELD_KINDS,
    OPERATOR_LABELS,
    OPERATORS_BY_FIELD,
    valueKindFor,
} from "../advanced-query-builder/AdvancedQueryUtils";
import { FilterValueInput } from "../advanced-query-builder/FilterValueInput";
import { isMetadataPaletteTag } from "./metadata-palette";
import type { QueryTagConstraint } from "./types";

const DEFAULT_OP: Partial<Record<Tag["type"], FilterOp>> = {
    text: "is",
    number: "eq",
    date: "on",
    datetime: "on",
    checkbox: "is_true",
};

export function TagConstraintDialog({
    tag,
    initial,
    onClose,
    onSave,
    onDelete,
}: {
    tag: Tag;
    initial?: QueryTagConstraint;
    onClose: () => void;
    onSave: (constraint: QueryTagConstraint) => void;
    onDelete?: () => void;
}) {
    const [op, setOp] = useState<FilterOp>(
        initial?.op ?? DEFAULT_OP[tag.type] ?? "is_applied",
    );
    const [value, setValue] = useState(initial?.value ?? "");
    const [error, setError] = useState<string | null>(null);
    const { colors } = useAppTheme();
    const fieldKind = isMetadataPaletteTag(tag)
        ? METADATA_FIELD_KINDS[tag.metadataKey]
        : tag.type;
    const valueKind = valueKindFor(fieldKind, op);
    const valueOperators = OPERATORS_BY_FIELD[fieldKind].filter(
        (option) => valueKindFor(fieldKind, option) !== "none",
    );
    const valuelessOperators = OPERATORS_BY_FIELD[fieldKind].filter(
        (option) => valueKindFor(fieldKind, option) === "none",
    );

    function chooseOp(next: FilterOp) {
        setOp(next);
        setError(null);
    }

    function save() {
        try {
            const normalized = filterValue(fieldKind, op, value);
            onSave({ op, value: normalized });
        } catch (cause) {
            setError(
                cause instanceof Error ? cause.message : "Enter a valid value.",
            );
        }
    }

    return (
        <ModalPopup
            keyboardAware
            visible
            onClose={onClose}
            title={onDelete ? `Edit ${tag.name}` : `Filter ${tag.name}`}
            titleClassName="text-xl font-bold"
            contentStyle={{ width: "92%", maxHeight: "82%" }}
        >
            <ScrollView
                style={{ flexShrink: 1 }}
                keyboardShouldPersistTaps="handled"
                contentContainerClassName="pb-1"
            >
                {valueOperators.length ? (
                    <View className="mt-1 flex-row gap-3">
                        <View className="min-w-0 flex-1 gap-2">
                            <Text className="text-sm font-semibold">
                                Condition
                            </Text>
                            <View>
                                <View className="flex-row flex-wrap gap-2 pr-1">
                                    {valueOperators.map((option) => (
                                        <ConditionOption
                                            key={option}
                                            option={option}
                                            selected={op === option}
                                            onPress={() => chooseOp(option)}
                                        />
                                    ))}
                                </View>
                            </View>
                        </View>
                        <View className="min-w-0 flex-1 items-center justify-center gap-2">
                            <Text className="text-sm font-semibold">Value</Text>
                            <View className="min-h-10 w-full justify-center rounded-lg border border-border px-1">
                                {valueKind === "none" ? (
                                    <Text className="px-2 text-sm text-muted-foreground">
                                        No value needed
                                    </Text>
                                ) : (
                                    <FilterValueInput
                                        kind={valueKind}
                                        value={value}
                                        compact
                                        onChange={(next) => {
                                            setValue(next);
                                            setError(null);
                                        }}
                                    />
                                )}
                            </View>
                        </View>
                    </View>
                ) : null}
                {valuelessOperators.length ? (
                    <View className="mt-3 gap-2">
                        {valueOperators.length ? (
                            <View className="h-px bg-border" />
                        ) : null}
                        <View className="flex-row flex-wrap gap-2">
                            {valuelessOperators.map((option) => (
                                <ConditionOption
                                    key={option}
                                    option={option}
                                    selected={op === option}
                                    onPress={() => chooseOp(option)}
                                />
                            ))}
                        </View>
                    </View>
                ) : null}
                {error ? (
                    <Text className="text-sm text-destructive">{error}</Text>
                ) : null}
            </ScrollView>
            <View className="mt-3 shrink-0 flex-row items-center gap-2">
                {onDelete ? (
                    <Pressable
                        onPress={onDelete}
                        className="mr-auto h-10 w-10 items-center justify-center"
                        accessibilityRole="button"
                        accessibilityLabel="Delete tag"
                    >
                        <Ionicons
                            name="trash-outline"
                            size={20}
                            color={colors.destructive}
                        />
                    </Pressable>
                ) : null}
                <Pressable
                    onPress={onClose}
                    className="ml-auto min-h-10 justify-center px-3"
                    accessibilityRole="button"
                >
                    <Text className="text-sm font-semibold">Cancel</Text>
                </Pressable>
                <Pressable
                    onPress={save}
                    className="min-h-10 justify-center rounded-lg bg-foreground px-4"
                    accessibilityRole="button"
                >
                    <Text className="text-sm font-semibold text-background">
                        {onDelete ? "Save" : "Apply"}
                    </Text>
                </Pressable>
            </View>
        </ModalPopup>
    );
}

function ConditionOption({
    option,
    selected,
    onPress,
}: {
    option: FilterOp;
    selected: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            className={`rounded-full border px-3 py-2 ${selected ? "border-foreground bg-foreground" : "border-border"}`}
        >
            <Text
                className={`text-sm font-semibold ${selected ? "text-background" : "text-foreground"}`}
            >
                {OPERATOR_LABELS[option]}
            </Text>
        </Pressable>
    );
}

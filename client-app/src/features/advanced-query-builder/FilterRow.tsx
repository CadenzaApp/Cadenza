import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";

import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

import {
    OPERATORS_BY_FIELD,
    OPERATOR_LABELS,
    fieldKindOf,
    valueKindFor,
} from "./AdvancedQueryUtils";
import type { BuilderActions, BuilderTags } from "./FilterGroup";
import { FilterValueInput } from "./FilterValueInput";
import { OptionPicker, PickerSection } from "./OptionPicker";
import { PROPERTY_FIELDS, TYPE_ICONS } from "./field-icons";
import { AdvancedFilterNode, FilterField, FilterOp } from "./types";

/**
 * Just wide enough for "where", so every line's filter starts at the same
 * spot without leaving a gap after the word.
 */
const CONNECTOR_WIDTH = 42;

type Props = {
    filter: AdvancedFilterNode;
    /** "where", "and", or "or" */
    connector: string;
    tags: BuilderTags;
    actions: BuilderActions;
};

function fieldKey(field: FilterField | null): string | null {
    if (!field) return null;
    return field.kind === "tag" ? `tag:${field.tagId}` : field.kind;
}

function fieldFromKey(key: string): FilterField {
    if (key.startsWith("tag:")) {
        return { kind: "tag", tagId: Number(key.slice("tag:".length)) };
    }
    return { kind: key as "tag_name" | "tag_value" | "tag_type" };
}

/**
 * One "where <tag> <operator> <value>" line. The line scrolls sideways when it
 * is wider than the screen; the remove button stays pinned on the right.
 */
export function FilterRow({ filter, connector, tags, actions }: Props) {
    const { colors } = useTheme();
    const [picker, setPicker] = useState<"field" | "op" | null>(null);

    const kind = fieldKindOf(filter.field, tags.types);
    const ops = kind ? OPERATORS_BY_FIELD[kind] : [];
    const valueKind =
        kind && filter.op ? valueKindFor(kind, filter.op) : "none";

    let fieldLabel = "Select tag";
    let fieldIcon = TYPE_ICONS.basic;
    let fieldIconColor = colors.text;
    if (filter.field?.kind === "tag") {
        const tag = tags.byId.get(filter.field.tagId);
        fieldLabel = tag?.name ?? "Unknown tag";
        if (tag) {
            fieldIcon = TYPE_ICONS[tag.type];
            fieldIconColor = tag.color;
        }
    } else if (filter.field) {
        const kindOfField = filter.field.kind;
        const property = PROPERTY_FIELDS.find((p) => p.kind === kindOfField);
        if (property) {
            fieldLabel = property.label;
            fieldIcon = property.icon;
        }
    }

    const fieldSections: PickerSection[] = useMemo(
        () => [
            {
                title: "Properties",
                options: PROPERTY_FIELDS.map((property) => ({
                    key: property.kind,
                    label: property.label,
                    icon: property.icon,
                })),
            },
            {
                title: "Your tags",
                options: tags.list.map((tag) => ({
                    key: `tag:${tag.id}`,
                    label: tag.name,
                    icon: TYPE_ICONS[tag.type],
                    iconColor: tag.color,
                })),
            },
        ],
        [tags.list],
    );

    return (
        <View className="flex-row items-center gap-1.5">
            <Text
                numberOfLines={1}
                className="text-sm text-muted-foreground"
                style={{ width: CONNECTOR_WIDTH }}
            >
                {connector}
            </Text>

            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                className="flex-1"
            >
                <View className="flex-row items-center rounded-md border border-border bg-background">
                    <Pressable
                        onPress={() => setPicker("field")}
                        accessibilityLabel="Choose what to filter on"
                        className="h-10 flex-row items-center gap-1.5 px-3 active:bg-accent"
                    >
                        <Ionicons
                            name={fieldIcon}
                            size={16}
                            color={fieldIconColor}
                        />
                        <Text
                            className={cn(
                                "text-base",
                                !filter.field && "text-muted-foreground",
                            )}
                            numberOfLines={1}
                        >
                            {fieldLabel}
                        </Text>
                        <Ionicons
                            name="chevron-expand"
                            size={14}
                            color={colors.text}
                        />
                    </Pressable>

                    {kind && filter.op && (
                        <>
                            <View className="h-10 w-px bg-border" />
                            <Pressable
                                onPress={() => setPicker("op")}
                                accessibilityLabel="Choose an operator"
                                className="h-10 flex-row items-center gap-1.5 px-3 active:bg-accent"
                            >
                                <Text className="text-base">
                                    {OPERATOR_LABELS[filter.op]}
                                </Text>
                                <Ionicons
                                    name="chevron-expand"
                                    size={14}
                                    color={colors.text}
                                />
                            </Pressable>
                        </>
                    )}

                    {valueKind !== "none" && (
                        <>
                            <View className="h-10 w-px bg-border" />
                            <FilterValueInput
                                kind={valueKind}
                                value={filter.value}
                                onChange={(value) =>
                                    actions.updateFilter(filter.id, (f) => ({
                                        ...f,
                                        value,
                                    }))
                                }
                            />
                        </>
                    )}
                </View>
            </ScrollView>

            <RemoveButton
                label="Remove filter"
                onPress={() => actions.remove(filter.id)}
            />

            <OptionPicker
                visible={picker === "field"}
                title="Filter on"
                searchable
                sections={fieldSections}
                selectedKey={fieldKey(filter.field)}
                emptyText="No matching tags"
                onSelect={(key) => {
                    setPicker(null);
                    actions.setFilterField(filter.id, fieldFromKey(key));
                }}
                onClose={() => setPicker(null)}
            />

            <OptionPicker
                visible={picker === "op"}
                title="Operator"
                sections={[
                    {
                        options: ops.map((op) => ({
                            key: op,
                            label: OPERATOR_LABELS[op],
                        })),
                    },
                ]}
                selectedKey={filter.op}
                onSelect={(key) => {
                    setPicker(null);
                    actions.setFilterOp(filter.id, key as FilterOp);
                }}
                onClose={() => setPicker(null)}
            />
        </View>
    );
}

export function RemoveButton({
    label,
    onPress,
}: {
    label: string;
    onPress: () => void;
}) {
    const { colors } = useTheme();
    return (
        <Pressable
            onPress={onPress}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={label}
            className="h-8 w-8 items-center justify-center rounded-md active:bg-accent"
        >
            <Ionicons name="close" size={18} color={colors.text} />
        </Pressable>
    );
}

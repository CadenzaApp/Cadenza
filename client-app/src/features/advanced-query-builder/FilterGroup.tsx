import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";

import { Text } from "@/components/ui/text";
import { Tag, TagType } from "@/lib/types";
import { cn } from "@/lib/utils";

import {
    CONJUNCTIONS,
    CONJUNCTION_LABELS,
    connectorLabel,
} from "./AdvancedQueryUtils";
import { FilterRow, RemoveButton } from "./FilterRow";
import { IconName, OptionPicker } from "./OptionPicker";
import {
    AdvancedFilterNode,
    AdvancedGroupNode,
    FilterField,
    FilterOp,
    GroupConjunction,
} from "./types";

/** The user's tags, in the shapes the rows need. */
export type BuilderTags = {
    list: Tag[];
    byId: ReadonlyMap<number, Tag>;
    types: ReadonlyMap<number, TagType>;
};

/** Every edit the tree supports, bound to the builder's state. */
export type BuilderActions = {
    addFilter: (groupId: string) => void;
    addGroup: (groupId: string) => void;
    remove: (nodeId: string) => void;
    setConjunction: (groupId: string, conjunction: GroupConjunction) => void;
    setFilterField: (filterId: string, field: FilterField) => void;
    setFilterOp: (filterId: string, op: FilterOp) => void;
    updateFilter: (
        filterId: string,
        update: (filter: AdvancedFilterNode) => AdvancedFilterNode,
    ) => void;
};

/**
 * Faintly outlined so the group selector and the add buttons read as buttons.
 * Spacing and the border are set inline so they apply whatever nativewind
 * resolves; the border uses the theme's faint border color.
 */
const OUTLINED_BUTTON_STYLE = {
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignSelf: "flex-start",
} as const;

type Props = {
    group: AdvancedGroupNode;
    isRoot?: boolean;
    tags: BuilderTags;
    actions: BuilderActions;
};

/**
 * A group of filters combined by all / any / none, with its own "Add filter"
 * and "Add filter group" buttons. Nested groups render as bordered cards.
 */
export function FilterGroup({ group, isRoot, tags, actions }: Props) {
    const { colors } = useTheme();
    const [pickingConjunction, setPickingConjunction] = useState(false);

    return (
        <View
            className={cn(
                "gap-2.5",
                !isRoot && "rounded-lg border border-border bg-card p-3",
            )}
        >
            <View className="flex-row items-center justify-between">
                <Pressable
                    onPress={() => setPickingConjunction(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Change how filters combine"
                    className="flex-row items-center rounded-md border border-border bg-background active:opacity-60"
                    style={[
                        OUTLINED_BUTTON_STYLE,
                        { borderColor: colors.border },
                    ]}
                >
                    <Text className="text-base font-medium">
                        {CONJUNCTION_LABELS[group.conjunction]}
                    </Text>
                    <Ionicons
                        name="chevron-expand"
                        size={16}
                        color={colors.text}
                    />
                </Pressable>

                {!isRoot && (
                    <RemoveButton
                        label="Remove filter group"
                        onPress={() => actions.remove(group.id)}
                    />
                )}
            </View>

            {group.children.length === 0 && (
                <Text className="text-sm text-muted-foreground">
                    No filters yet
                </Text>
            )}

            {group.children.map((child, index) =>
                child.kind === "filter" ? (
                    <FilterRow
                        key={child.id}
                        filter={child}
                        connector={connectorLabel(group.conjunction, index)}
                        tags={tags}
                        actions={actions}
                    />
                ) : (
                    <FilterGroup
                        key={child.id}
                        group={child}
                        tags={tags}
                        actions={actions}
                    />
                ),
            )}

            <View
                className="flex-row flex-wrap"
                style={{ columnGap: 12, rowGap: 8 }}
            >
                <AddButton
                    icon="add"
                    label="Add filter"
                    onPress={() => actions.addFilter(group.id)}
                />
                <AddButton
                    icon="add"
                    label="Add filter group"
                    onPress={() => actions.addGroup(group.id)}
                />
            </View>

            <OptionPicker
                visible={pickingConjunction}
                title="Match when"
                selectedKey={group.conjunction}
                sections={[
                    {
                        options: CONJUNCTIONS.map((conjunction) => ({
                            key: conjunction,
                            label: CONJUNCTION_LABELS[conjunction],
                        })),
                    },
                ]}
                onSelect={(key) => {
                    setPickingConjunction(false);
                    actions.setConjunction(group.id, key as GroupConjunction);
                }}
                onClose={() => setPickingConjunction(false)}
            />
        </View>
    );
}

function AddButton({
    icon,
    label,
    onPress,
}: {
    icon: IconName;
    label: string;
    onPress: () => void;
}) {
    const { colors } = useTheme();
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            className="flex-row items-center rounded-md border border-border bg-background active:opacity-60"
            style={[OUTLINED_BUTTON_STYLE, { borderColor: colors.border }]}
        >
            <Ionicons name={icon} size={18} color={colors.text} />
            <Text className="text-sm text-foreground">{label}</Text>
        </Pressable>
    );
}

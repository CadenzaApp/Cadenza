import React, { useEffect } from "react";
import { Pressable, StyleSheet, View, ViewStyle } from "react-native";
import { Text } from "@/components/ui/text";
import { QueryNode, PaletteItem, SlotAddress } from "./types";
import { TagPill } from "@/components/custom/tag-pill";
import { DropSlot } from "./DropSlot";
import { useDrag } from "./DragContext";

export const OPERATOR_COLORS = {
    AND: { bg: "#2E6EAD45", border: "#2E6EAD", text: "#2E6EAD" },
    OR: { bg: "#6E3AAD45", border: "#6E3AAD", text: "#6E3AAD" },
    NOT: { bg: "#c4424245", border: "#c44242", text: "#c44242" },
} as const;

function SlotCell({
    node,
    slotKey,
    onDrop,
    onRemove,
    operator,
}: {
    node: QueryNode | null;
    slotKey: string;
    onDrop: (item: PaletteItem, address: SlotAddress) => void;
    onRemove: (id: string) => void;
    operator?: keyof typeof OPERATOR_COLORS;
}) {
    if (!node) {
        return (
            <DropSlot
                slotKey={slotKey}
                style={{
                    borderColor: OPERATOR_COLORS[operator ?? "AND"].border,
                }}
            >
                <Text
                    style={styles.emptySlotText}
                    className="text-muted-foreground"
                >
                    Drop
                </Text>
            </DropSlot>
        );
    }

    if (node.kind === "tag") {
        return (
            <DropSlot slotKey={slotKey} style={styles.filledSlot}>
                <TagPill
                    tag={node.tag}
                    height={12}
                    onRemove={() => onRemove(node.id)}
                />
            </DropSlot>
        );
    }

    return (
        <DropSlot slotKey={`${node.id}:append`} naked>
            <LogicNodeBox node={node} onDrop={onDrop} onRemove={onRemove} />
        </DropSlot>
    );
}

export function LogicNodeBox({
    node,
    onDrop,
    onRemove,
    style,
}: {
    node: Extract<QueryNode, { kind: "logic" }>;
    onDrop: (item: PaletteItem, address: SlotAddress) => void;
    onRemove: (id: string) => void;
    style?: ViewStyle;
}) {
    const { registerNodeOperator, unregisterNodeOperator } = useDrag();
    const { bg, border, text } = OPERATOR_COLORS[node.operator];
    const { id, operator, children } = node;

    useEffect(() => {
        registerNodeOperator(id, operator);
        return () => unregisterNodeOperator(id);
    }, [id, operator]);

    const removeButton = (
        <View style={[styles.logicRemoveBtn]}>
            <Pressable onPress={() => onRemove(id)} hitSlop={8}>
                <Text
                    style={(styles.logicRemoveText, { color: border })}
                    className="text-muted-foreground"
                >
                    ×
                </Text>
            </Pressable>
        </View>
    );

    if (operator === "NOT") {
        return (
            <View
                style={[
                    styles.boxRow,
                    { backgroundColor: bg, borderColor: border },
                    style,
                ]}
            >
                {removeButton}
                <Text style={[styles.label, { color: text }]}>NOT</Text>
                <SlotCell
                    node={children[0] ?? null}
                    slotKey={`${id}:0`}
                    onDrop={onDrop}
                    onRemove={onRemove}
                    operator={operator}
                />
            </View>
        );
    }

    if (operator === "AND") {
        return (
            <View
                style={[
                    styles.boxCol,
                    { backgroundColor: bg, borderColor: border },
                    style,
                ]}
            >
                {removeButton}
                {children.map((child, i) => (
                    <React.Fragment key={i}>
                        <SlotCell
                            node={child}
                            slotKey={`${id}:${i}`}
                            onDrop={onDrop}
                            onRemove={onRemove}
                            operator={operator}
                        />
                        {i < children.length - 1 && (
                            <Text style={[styles.label, { color: text }]}>
                                AND
                            </Text>
                        )}
                    </React.Fragment>
                ))}
            </View>
        );
    }

    return (
        <View
            style={[
                styles.boxRow,
                { backgroundColor: bg, borderColor: border },
                style,
            ]}
        >
            {removeButton}
            {children.map((child, i) => (
                <React.Fragment key={i}>
                    <SlotCell
                        node={child}
                        slotKey={`${id}:${i}`}
                        onDrop={onDrop}
                        onRemove={onRemove}
                        operator={operator}
                    />
                    {i < children.length - 1 && (
                        <Text style={[styles.label, { color: text }]}>OR</Text>
                    )}
                </React.Fragment>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    boxCol: {
        alignItems: "center",
        paddingTop: 16,
        paddingLeft: 18,
        paddingRight: 18,
        paddingBottom: 16,
        paddingHorizontal: 10,
        borderRadius: 12,
        borderWidth: 1.5,
        gap: 6,
        alignSelf: "flex-start",
    },
    boxRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingTop: 16,
        paddingBottom: 16,
        paddingLeft: 18,
        paddingRight: 18,
        paddingHorizontal: 10,
        borderRadius: 12,
        borderWidth: 1.5,
        gap: 6,
        alignSelf: "flex-start",
        flexWrap: "wrap",
    },
    logicRemoveBtn: {
        position: "absolute",
        top: 3,
        right: 6,
        zIndex: 10,
    },
    logicRemoveText: {
        fontSize: 15,
        lineHeight: 15,
    },
    label: {
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 1.5,
        marginHorizontal: 2,
    },
    emptySlotText: {
        fontSize: 10,
        letterSpacing: 1,
    },
    filledSlot: {
        borderWidth: 0,
        backgroundColor: "transparent",
        minWidth: 0,
        minHeight: 0,
        padding: 2,
    },
    tagSlotContent: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    removeText: {
        fontSize: 14,
        lineHeight: 14,
    },
});

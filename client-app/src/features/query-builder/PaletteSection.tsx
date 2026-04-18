import React, { useState } from "react";
import { LayoutAnimation, Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/text";
import { PaletteItem, SlotAddress, LogicOperator } from "./types";
import { TagPill } from "@/components/custom/tag-pill";
import { DraggablePill } from "./DraggablePill";
import { OPERATOR_COLORS } from "./LogicNode";

function OperatorTile({ operator }: { operator: LogicOperator }) {
    const { bg, border, text } = OPERATOR_COLORS[operator];
    return (
        <View
            style={[
                styles.opTile,
                { backgroundColor: bg, borderColor: border },
            ]}
        >
            <Text style={[styles.opText, { color: text }]}>{operator}</Text>
        </View>
    );
}

export function PaletteSection({
    title,
    items,
    onDrop,
    defaultOpen = false,
}: {
    title: string;
    items: PaletteItem[];
    onDrop: (item: PaletteItem, address: SlotAddress) => void;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);

    const toggle = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setOpen((v) => !v);
    };

    return (
        <View style={styles.section} className="bg-card border-border">
            <Pressable onPress={toggle}>
                <View style={styles.header}>
                    <Text style={styles.headerText} className="text-foreground">
                        {title}
                    </Text>
                    <Text style={styles.chevron} className="text-foreground">
                        {open ? "▲" : "▼"}
                    </Text>
                </View>
            </Pressable>

            {open && (
                <View style={styles.itemsRow}>
                    {items.map((item, i) => (
                        <DraggablePill key={i} item={item} onDrop={onDrop}>
                            {item.kind === "logic" ? (
                                <OperatorTile operator={item.operator} />
                            ) : (
                                <TagPill tag={item.tag} height={12} />
                            )}
                        </DraggablePill>
                    ))}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    section: {
        borderRadius: 12,
        marginBottom: 10,
        borderWidth: 1,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    headerText: {
        fontWeight: "600",
        fontSize: 13,
        letterSpacing: 0.5,
    },
    chevron: {
        fontSize: 10,
    },
    itemsRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        paddingHorizontal: 12,
        paddingBottom: 12,
    },
    opTile: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1.5,
    },
    opText: {
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 1.5,
    },
});

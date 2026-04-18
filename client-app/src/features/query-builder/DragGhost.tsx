import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useDrag } from "./DragContext";
import { OPERATOR_COLORS } from "./LogicNode";
import { TagPill } from "@/components/custom/tag-pill";

// Half sizes to match the ghost to where the users finger is
const GHOST_HALF_W = 16;
const GHOST_HALF_H = 42;

/** Represents a floating palette item the user is dragging */
export function DragGhost() {
    // take from drag context
    const { dragState, rootOffset } = useDrag();
    if (!dragState) return null;

    const { item, x, y } = dragState;

    // convert screen-space coordinates to container relative coordinates,
    // then offset by half the ghost's size so it's centered on the finger
    const left = x - rootOffset.x - GHOST_HALF_W;
    const top = y - rootOffset.y - GHOST_HALF_H;

    return (
        <View style={[styles.ghost, { left, top }]} pointerEvents="none">
            {item.kind === "logic" ? (
                <View
                    style={[
                        styles.opGhost,
                        {
                            backgroundColor: OPERATOR_COLORS[item.operator].bg,
                            borderColor: OPERATOR_COLORS[item.operator].border,
                        },
                    ]}
                >
                    <Text
                        style={[
                            styles.opText,
                            { color: OPERATOR_COLORS[item.operator].text },
                        ]}
                    >
                        {item.operator}
                    </Text>
                </View>
            ) : (
                <TagPill tag={item.tag} height={12} />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    ghost: {
        position: "absolute",
        zIndex: 9999,
        opacity: 0.9,
        transform: [{ scale: 1.08 }],
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.45,
        shadowRadius: 8,
        elevation: 20,
        pointerEvents: "none", // Prevent the ghost from intercepting touch events on zones below it
    },
    opGhost: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1.5,
    },
    opText: {
        fontWeight: "700",
        fontSize: 12,
        letterSpacing: 1.5,
    },
});

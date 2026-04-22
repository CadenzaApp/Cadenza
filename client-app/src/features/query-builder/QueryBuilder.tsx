import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/text";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import {
    QueryNode,
    PaletteItem,
    SlotAddress,
    QuerySongsApiResult,
} from "./types";
import { TagPill } from "@/components/custom/tag-pill";
import {
    insertAtSlot,
    removeNode,
    findNodeById,
    getSongsFromQuery,
} from "./QueryUtils";
import { DragProvider } from "./DragContext";
import { DragGhost } from "./DragGhost";
import { PaletteSection } from "./PaletteSection";
import { LogicNodeBox } from "./LogicNode";
import { DropSlot } from "./DropSlot";
import { Button } from "@/components/ui/button";
import { Tag } from "@/lib/types";
import { useAccount } from "@/lib/account";

const LOGIC_ITEMS: PaletteItem[] = [
    { kind: "logic", operator: "and" },
    { kind: "logic", operator: "or" },
    { kind: "logic", operator: "not" },
];

type Props = {
    tags: Tag[];
    onQueryReturn: (matchedSongs: QuerySongsApiResult) => any;
};
export function QueryBuilder({ tags, onQueryReturn }: Props) {
    const { account } = useAccount();
    const [root, setRoot] = useState<QueryNode | null>(null);

    const tagPaletteItems: PaletteItem[] = tags.map((t) => ({
        kind: "tag",
        tag: t,
    }));

    function handleDrop(item: PaletteItem, address: SlotAddress) {
        setRoot((prev) => {
            if (item.kind === "logic" && address.nodeId !== "root") {
                const targetNode = findNodeById(prev, address.nodeId);
                if (
                    targetNode?.kind === "logic" &&
                    targetNode.operator === item.operator
                ) {
                    return prev;
                }
            }
            const next = insertAtSlot(prev, address, item);
            return next;
        });
    }

    function handleRemove(id: string) {
        setRoot((prev) => {
            const next = removeNode(prev, id);
            return next;
        });
    }

    async function onSubmit() {
        if (root == null) {
            console.error("query is empty!");
            return;
        }
        if (account == null) {
            console.error("not signed in");
            return;
        }

        try {
            const matchedSongs = await getSongsFromQuery(root, account?.jwt);
            onQueryReturn(matchedSongs);
        } catch (e) {
            console.error("error getting songs from query:", e);
        }
    }

    return (
        <GestureHandlerRootView style={styles.root} className="bg-background">
            <DragProvider>
                <View style={styles.container}>
                    {/* Palette */}
                    <View style={styles.palette}>
                        <PaletteSection
                            title="Tags"
                            items={tagPaletteItems}
                            onDrop={handleDrop}
                        />
                        <PaletteSection
                            title="Logic"
                            items={LOGIC_ITEMS}
                            onDrop={handleDrop}
                            defaultOpen
                        />
                    </View>

                    {/* Workspace */}
                    <ScrollView
                        style={styles.workspace}
                        contentContainerStyle={styles.workspaceContent}
                    >
                        {root === null ? (
                            <DropSlot slotKey="root" style={styles.rootSlot}>
                                <Text
                                    style={styles.workspaceHint}
                                    className="text-muted-foreground"
                                >
                                    Drag a tag or logic operator here
                                </Text>
                            </DropSlot>
                        ) : root.kind === "tag" ? (
                            <DropSlot
                                slotKey="root"
                                style={styles.rootSlotFilled}
                            >
                                <TagPill
                                    tag={root.tag}
                                    height={15}
                                    onRemove={() => handleRemove(root.id)}
                                />
                            </DropSlot>
                        ) : (
                            <DropSlot slotKey={`${root.id}:append`} naked>
                                <LogicNodeBox
                                    node={root}
                                    onDrop={handleDrop}
                                    onRemove={handleRemove}
                                />
                            </DropSlot>
                        )}
                    </ScrollView>

                    <Button onPress={onSubmit}>
                        <Text> Create mix </Text>
                    </Button>
                </View>
                <DragGhost />
            </DragProvider>
        </GestureHandlerRootView>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    container: {
        flex: 1,
        padding: 16,
        gap: 12,
    },
    palette: {
        gap: 0,
    },
    workspace: {
        flex: 1,
    },
    workspaceContent: {
        paddingVertical: 16,
        flexGrow: 1,
        alignItems: "flex-start",
    },
    rootSlot: {
        width: "100%",
        minHeight: 250,
        alignItems: "center",
        justifyContent: "center",
    },
    rootSlotFilled: {
        borderWidth: 0,
        backgroundColor: "transparent",
        minWidth: 0,
        minHeight: 0,
        padding: 10,
        alignSelf: "flex-start",
    },
    workspaceHint: {
        fontSize: 13,
        textAlign: "center",
    },
});

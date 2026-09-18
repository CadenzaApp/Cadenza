import { useMemo } from "react";
import { ScrollView, View } from "react-native";

import { Text } from "@/components/ui/text";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { Tag } from "@/lib/types";

import {
    addChild,
    createFilter,
    createGroup,
    removeNode,
    setConjunction,
    updateFilter,
    withField,
    withOp,
} from "./AdvancedQueryUtils";
import { BuilderActions, BuilderTags, FilterGroup } from "./FilterGroup";
import { AdvancedGroupNode } from "./types";

type Props = {
    tags: Tag[];
    root: AdvancedGroupNode;
    setRoot: (update: (root: AdvancedGroupNode) => AdvancedGroupNode) => void;
    /** Shown beneath the editor when the current tree cannot be compiled. */
    message?: string | null;
};

/**
 * Obsidian-style filter builder: nested groups of "where <tag> <op> <value>"
 * lines. The screen owns the tree and the fetch; this only edits the tree.
 */
export function AdvancedQueryBuilder({ tags, root, setRoot, message }: Props) {
    const { contentBottomInset } = useScreenOverlayInsets();
    const builderTags = useMemo<BuilderTags>(
        () => ({
            list: tags,
            byId: new Map(tags.map((tag) => [tag.id, tag])),
            types: new Map(tags.map((tag) => [tag.id, tag.type])),
        }),
        [tags],
    );

    const actions = useMemo<BuilderActions>(
        () => ({
            addFilter: (groupId) =>
                setRoot((r) => addChild(r, groupId, createFilter())),
            addGroup: (groupId) =>
                setRoot((r) => addChild(r, groupId, createGroup())),
            remove: (nodeId) => setRoot((r) => removeNode(r, nodeId)),
            setConjunction: (groupId, conjunction) =>
                setRoot((r) => setConjunction(r, groupId, conjunction)),
            setFilterField: (filterId, field) =>
                setRoot((r) =>
                    updateFilter(r, filterId, (f) =>
                        withField(f, field, builderTags.types),
                    ),
                ),
            setFilterOp: (filterId, op) =>
                setRoot((r) =>
                    updateFilter(r, filterId, (f) =>
                        withOp(f, op, builderTags.types),
                    ),
                ),
            updateFilter: (filterId, update) =>
                setRoot((r) => updateFilter(r, filterId, update)),
        }),
        [setRoot, builderTags],
    );

    return (
        <View
            className="flex-1 gap-3 px-4 pt-4"
            style={{ paddingBottom: contentBottomInset + 16 }}
        >
            <ScrollView
                className="flex-1"
                contentContainerClassName="pb-6"
                keyboardShouldPersistTaps="handled"
            >
                <FilterGroup
                    group={root}
                    isRoot
                    tags={builderTags}
                    actions={actions}
                />
            </ScrollView>

            {message && (
                <Text className="text-center text-sm text-muted-foreground">
                    {message}
                </Text>
            )}
        </View>
    );
}

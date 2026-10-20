import { useMemo, type ReactNode } from "react";
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
    resultsAction?: ReactNode;
    historyAction?: ReactNode;
    tags: Tag[];
    /** My Plays and the rest, offered after the user's own tags. */
    activityTags: Tag[];
    root: AdvancedGroupNode;
    setRoot: (
        update: (root: AdvancedGroupNode) => AdvancedGroupNode,
        coalesceKey?: string,
    ) => void;
    /** Shown beneath the editor when the current tree cannot be compiled. */
    message?: string | null;
};

/**
 * Obsidian-style filter builder: nested groups of "where <tag> <op> <value>"
 * lines. The screen owns the tree and the fetch; this only edits the tree.
 */
export function AdvancedQueryBuilder({
    resultsAction,
    historyAction,
    tags,
    activityTags,
    root,
    setRoot,
    message,
}: Props) {
    // the native tab bar floats over this screen, so the floating actions
    // and the editor's bottom edge clear all of it, the same as the palette
    // in the simple builder
    const { floatingOverTabBarBottom } = useScreenOverlayInsets();
    const builderTags = useMemo<BuilderTags>(() => {
        const every = [...tags, ...activityTags];
        return {
            list: tags,
            activity: activityTags,
            byId: new Map(every.map((tag) => [tag.id, tag])),
            types: new Map(every.map((tag) => [tag.id, tag.type])),
        };
    }, [tags, activityTags]);

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
                setRoot(
                    (r) => updateFilter(r, filterId, update),
                    `value:${filterId}`,
                ),
        }),
        [setRoot, builderTags],
    );

    return (
        <View
            className="flex-1 gap-3 px-4 pt-4"
            style={{ paddingBottom: floatingOverTabBarBottom }}
        >
            <ScrollView
                className="flex-1"
                contentContainerClassName="pb-16"
                keyboardShouldPersistTaps="handled"
            >
                <FilterGroup
                    group={root}
                    isRoot
                    tags={builderTags}
                    actions={actions}
                />
            </ScrollView>

            <View
                pointerEvents="box-none"
                className="absolute right-5 left-5 flex-row items-start justify-between"
                style={{ bottom: floatingOverTabBarBottom }}
            >
                <View>{historyAction}</View>
                {resultsAction}
            </View>
            {message && (
                <Text className="mb-14 text-center text-sm text-muted-foreground">
                    {message}
                </Text>
            )}
        </View>
    );
}

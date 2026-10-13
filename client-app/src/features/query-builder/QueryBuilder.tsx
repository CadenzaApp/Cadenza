import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type ReactNode,
    type Dispatch,
    type SetStateAction,
} from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { DropSlot } from "./DropSlot";
import { EditorActionsContext } from "./EditorActions";
import Animated from "react-native-reanimated";

import type { Tag, TagMetadata } from "@/lib/types";
import {
    supportsNativeTabBottomAccessory,
    useScreenOverlayInsets,
} from "@/lib/screen-overlay";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ConditionList } from "./ConditionList";
import { DragGhost } from "./DragGhost";
import { DragProvider, useDrag } from "./DragContext";
import {
    addTagToCondition,
    appendTag,
    insertTag,
    moveConditionToIndex,
    moveQueryTagToCondition,
    moveQueryTagToIndex,
    removeCondition,
    removeQueryTag,
    setGroupMode,
    toggleConditionNegation,
    updateQueryTagConstraint,
} from "./QueryUtils";
import { TagPalette } from "./TagPalette";
import { TagConstraintDialog } from "./TagConstraintDialog";
import type {
    DragPayload,
    DropTarget,
    QueryCondition,
    QueryGroupMode,
    QueryConnector,
    QueryTag,
    QueryTagConstraint,
} from "./types";

type Props = {
    headingOverlapHeight: number;
    resultsAction: ReactNode;
    historyAction: ReactNode;
    showVennDiagrams: boolean;
    showAdvancedTags: boolean;
    showMetadataTags: boolean;
    tags: Tag[];
    tagMetadata?: Readonly<Record<number, TagMetadata>>;
    conditions: QueryCondition[];
    setConditions: Dispatch<SetStateAction<QueryCondition[]>>;
    pendingTag: {
        tag: Tag;
        suggested: boolean;
        conditionIds: string[];
    } | null;
    setPendingTag: Dispatch<
        SetStateAction<{
            tag: Tag;
            suggested: boolean;
            conditionIds: string[];
        } | null>
    >;
    includeSuggestedTags: boolean;
    outerConnector: QueryConnector;
    onOuterConnectorChange: (value: QueryConnector) => void;
};
const DEFAULT_PALETTE_HEIGHT = 268;

export function QueryBuilder({
    headingOverlapHeight,
    resultsAction,
    historyAction,
    showVennDiagrams,
    showAdvancedTags,
    showMetadataTags,
    tags,
    tagMetadata,
    conditions,
    setConditions,
    pendingTag,
    setPendingTag,
    includeSuggestedTags,
    outerConnector,
    onOuterConnectorChange,
}: Props) {
    const { compactPlayerVisible, playerBottomInset } =
        useScreenOverlayInsets();
    // UIKit already removes the native accessory's space from this screen.
    // Growing the palette by the full bottom inset duplicates that footprint.
    const defaultPaletteHeight =
        DEFAULT_PALETTE_HEIGHT +
        (compactPlayerVisible && !supportsNativeTabBottomAccessory()
            ? playerBottomInset
            : 0);
    const paletteWasResized = useRef(false);
    const [paletteHeight, setPaletteHeight] = useState(defaultPaletteHeight);
    const handlePaletteHeightChange = useCallback((height: number) => {
        paletteWasResized.current = true;
        setPaletteHeight(height);
    }, []);
    const scroll = useScreenScroll();
    const [constraintDraft, setConstraintDraft] = useState<
        | { kind: "add"; tag: Tag; suggested: boolean; target: DropTarget }
        | { kind: "edit"; queryTag: QueryTag }
        | null
    >(null);
    const activePendingTag =
        pendingTag &&
        conditions.some((condition) =>
            pendingTag.conditionIds.includes(condition.id),
        )
            ? pendingTag
            : null;
    useEffect(() => {
        if (!paletteWasResized.current) {
            setPaletteHeight(defaultPaletteHeight);
        }
    }, [defaultPaletteHeight]);
    const handleDrop = useCallback(
        (payload: DragPayload, target: DropTarget) => {
            if (
                payload.source === "palette" &&
                payload.tag.type !== "basic" &&
                target.kind !== "delete"
            ) {
                if (target.kind === "condition") {
                    const destination = conditions.find(
                        (item) => item.id === target.conditionId,
                    );
                    if (
                        destination &&
                        (destination.kind === "tag"
                            ? destination.tag.id === payload.tag.id
                            : destination.members.some(
                                  (member) => member.tag.id === payload.tag.id,
                              ))
                    )
                        return;
                }
                setPendingTag(null);
                setConstraintDraft({
                    kind: "add",
                    tag: payload.tag,
                    suggested: payload.suggested,
                    target,
                });
                return;
            }
            setConditions((current) => {
                if (payload.source === "condition") {
                    if (target.kind === "delete") {
                        return removeCondition(current, payload.condition.id);
                    }
                    if (target.kind === "insert") {
                        return moveConditionToIndex(
                            current,
                            payload.condition.id,
                            target.index,
                        );
                    }
                    if (target.kind === "query-end") {
                        return moveConditionToIndex(
                            current,
                            payload.condition.id,
                            current.length,
                        );
                    }
                    return current;
                }
                if (payload.source === "palette") {
                    if (target.kind === "condition") {
                        return addTagToCondition(
                            current,
                            payload.tag,
                            target.conditionId,
                            payload.suggested,
                        );
                    }
                    if (target.kind === "insert") {
                        return insertTag(
                            current,
                            payload.tag,
                            target.index,
                            payload.suggested,
                        );
                    }
                    if (target.kind === "query-end") {
                        return appendTag(
                            current,
                            payload.tag,
                            payload.suggested,
                        );
                    }
                    return current;
                }

                if (target.kind === "delete") {
                    return removeQueryTag(current, payload.queryTag.id);
                }
                if (target.kind === "condition") {
                    return moveQueryTagToCondition(
                        current,
                        payload.queryTag.id,
                        target.conditionId,
                    );
                }
                if (target.kind === "insert") {
                    return moveQueryTagToIndex(
                        current,
                        payload.queryTag.id,
                        target.index,
                    );
                }
                return moveQueryTagToIndex(
                    current,
                    payload.queryTag.id,
                    current.length,
                );
            });
        },
        [conditions, setConditions, setPendingTag],
    );
    const toggleNegation = useCallback(
        (id: string) =>
            setConditions((current) => toggleConditionNegation(current, id)),
        [setConditions],
    );
    const changeMode = useCallback(
        (id: string, mode: QueryGroupMode) =>
            setConditions((current) => setGroupMode(current, id, mode)),
        [setConditions],
    );
    const selectPaletteTag = useCallback(
        (tag: Tag, suggested: boolean) => {
            if (conditions.length === 0) {
                setPendingTag(null);
                if (tag.type === "basic") {
                    setConditions((current) =>
                        appendTag(current, tag, suggested),
                    );
                } else {
                    setConstraintDraft({
                        kind: "add",
                        tag,
                        suggested,
                        target: { kind: "query-end" },
                    });
                }
            } else {
                setPendingTag({
                    tag,
                    suggested,
                    conditionIds: conditions.map((condition) => condition.id),
                });
            }
        },
        [conditions, setConditions, setPendingTag],
    );
    const placeTagInCondition = useCallback(
        (conditionId: string) => {
            if (!activePendingTag) return;
            if (activePendingTag.tag.type === "basic") {
                setConditions((current) =>
                    addTagToCondition(
                        current,
                        activePendingTag.tag,
                        conditionId,
                        activePendingTag.suggested,
                    ),
                );
            } else {
                setConstraintDraft({
                    kind: "add",
                    tag: activePendingTag.tag,
                    suggested: activePendingTag.suggested,
                    target: { kind: "condition", conditionId },
                });
            }
            setPendingTag(null);
        },
        [activePendingTag, setConditions, setPendingTag],
    );
    const placeTagInNewCondition = useCallback(() => {
        if (!activePendingTag) return;
        if (activePendingTag.tag.type === "basic") {
            setConditions((current) =>
                appendTag(
                    current,
                    activePendingTag.tag,
                    activePendingTag.suggested,
                ),
            );
        } else {
            setConstraintDraft({
                kind: "add",
                tag: activePendingTag.tag,
                suggested: activePendingTag.suggested,
                target: { kind: "query-end" },
            });
        }
        setPendingTag(null);
    }, [activePendingTag, setConditions, setPendingTag]);
    const saveConstraint = useCallback(
        (constraint: QueryTagConstraint) => {
            if (!constraintDraft) return;
            if (constraintDraft.kind === "edit") {
                setConditions((current) =>
                    updateQueryTagConstraint(
                        current,
                        constraintDraft.queryTag.id,
                        constraint,
                    ),
                );
            } else {
                const { tag, suggested, target } = constraintDraft;
                setConditions((current) => {
                    if (target.kind === "condition")
                        return addTagToCondition(
                            current,
                            tag,
                            target.conditionId,
                            suggested,
                            constraint,
                        );
                    if (target.kind === "insert")
                        return insertTag(
                            current,
                            tag,
                            target.index,
                            suggested,
                            constraint,
                        );
                    return appendTag(current, tag, suggested, constraint);
                });
            }
            setConstraintDraft(null);
        },
        [constraintDraft, setConditions],
    );

    return (
        <EditorActionsContext.Provider
            value={{
                showVennDiagrams,
                toggleOuterConnector: () =>
                    onOuterConnectorChange(
                        outerConnector === "and" ? "or" : "and",
                    ),
                removeGroup: (id) =>
                    setConditions((current) => removeCondition(current, id)),
                removeQueryTag: (id) =>
                    setConditions((current) => removeQueryTag(current, id)),
                editQueryTag: (queryTag) =>
                    setConstraintDraft({ kind: "edit", queryTag }),
                pendingTag: activePendingTag,
                placeTagInCondition,
                placeTagInNewCondition,
            }}
        >
            <DragProvider onDrop={handleDrop}>
                <KeyboardAvoidingView
                    className="flex-1"
                    style={
                        headingOverlapHeight
                            ? { marginTop: -headingOverlapHeight }
                            : undefined
                    }
                    behavior={Platform.OS === "ios" ? "padding" : undefined}
                    keyboardVerticalOffset={80}
                >
                    <View className="flex-1">
                        <ScreenScrollMarker>
                            <Animated.ScrollView
                                {...scroll}
                                className="flex-1"
                                contentContainerClassName="flex-grow px-[18px] pb-16"
                                contentContainerStyle={{
                                    paddingTop: headingOverlapHeight,
                                }}
                                keyboardShouldPersistTaps="handled"
                            >
                                <ConditionList
                                    conditions={conditions}
                                    onToggleConditionNegation={toggleNegation}
                                    onModeChange={changeMode}
                                />
                                {conditions.length > 0 ? (
                                    <>
                                        <DropSlot
                                            targetKey="workspace-end"
                                            target={{ kind: "query-end" }}
                                            className="min-h-12 flex-1"
                                        />
                                    </>
                                ) : null}
                            </Animated.ScrollView>
                        </ScreenScrollMarker>
                        <FloatingActions
                            historyAction={historyAction}
                            resultsAction={resultsAction}
                        />
                    </View>

                    <TagPalette
                        tags={tags}
                        tagMetadata={tagMetadata}
                        height={paletteHeight}
                        onHeightChange={handlePaletteHeightChange}
                        includeSuggestedTags={includeSuggestedTags}
                        showAdvancedTags={showAdvancedTags}
                        showMetadataTags={showMetadataTags}
                        pendingTag={activePendingTag}
                        onTagTap={selectPaletteTag}
                        usedTagIds={
                            new Set(
                                conditions.flatMap((condition) =>
                                    condition.kind === "tag"
                                        ? [condition.tag.id]
                                        : condition.members.map(
                                              (tag) => tag.tag.id,
                                          ),
                                ),
                            )
                        }
                    />
                </KeyboardAvoidingView>
                <DragGhost />
                {constraintDraft ? (
                    <TagConstraintDialog
                        key={
                            constraintDraft.kind === "edit"
                                ? constraintDraft.queryTag.id
                                : `${constraintDraft.tag.id}-${constraintDraft.target.kind}`
                        }
                        tag={
                            constraintDraft.kind === "edit"
                                ? constraintDraft.queryTag.tag
                                : constraintDraft.tag
                        }
                        initial={
                            constraintDraft.kind === "edit"
                                ? (constraintDraft.queryTag.constraint ?? {
                                      op: "is_applied",
                                  })
                                : undefined
                        }
                        onClose={() => setConstraintDraft(null)}
                        onSave={saveConstraint}
                        onDelete={
                            constraintDraft.kind === "edit"
                                ? () => {
                                      setConditions((current) =>
                                          removeQueryTag(
                                              current,
                                              constraintDraft.queryTag.id,
                                          ),
                                      );
                                      setConstraintDraft(null);
                                  }
                                : undefined
                        }
                    />
                ) : null}
            </DragProvider>
        </EditorActionsContext.Provider>
    );
}

function FloatingActions({
    historyAction,
    resultsAction,
}: {
    historyAction: ReactNode;
    resultsAction: ReactNode;
}) {
    const { dragState } = useDrag();
    if (dragState) return null;
    return (
        <View
            pointerEvents="box-none"
            className="absolute bottom-3 right-5 left-5 flex-row items-start justify-between"
        >
            <View>{historyAction}</View>
            {resultsAction}
        </View>
    );
}

import {
    useCallback,
    useEffect,
    useRef,
    useMemo,
    useState,
    type Dispatch,
    type ReactNode,
    type SetStateAction,
} from "react";
import { View } from "react-native";
import Animated, {
    useAnimatedStyle,
    useScrollOffset,
    useSharedValue,
    type SharedValue,
} from "react-native-reanimated";
import { DropSlot } from "./DropSlot";
import { DropViewport } from "./DropViewport";
import {
    PALETTE_CLEARANCE,
    TAG_PALETTE_MAX_HEIGHT,
    clampPaletteHeight,
} from "./palette-geometry";

import {
    supportsNativeTabBottomAccessory,
    useScreenOverlayInsets,
} from "@/lib/screen-overlay";
import { Text } from "@/components/ui/text";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import type { Tag, TagMetadata } from "@/lib/types";
import { ConditionList, EditorActionsContext } from "./ConditionList";
import { DragProvider, useDrag, useRefreshDragHover } from "./DragContext";
import { DragGhost } from "./DragGhost";
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
    usedTagIds as collectUsedTagIds,
} from "./QueryUtils";
import { TagConstraintDialog } from "./TagConstraintDialog";
import { TagPalette } from "./TagPalette";
import type {
    DragPayload,
    DropTarget,
    QueryCondition,
    QueryConnector,
    QueryGroupMode,
    QueryTag,
    QueryTagConstraint,
    TagPlacement,
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
    pendingTag: TagPlacement | null;
    setPendingTag: Dispatch<SetStateAction<TagPlacement | null>>;
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
    const visiblePaletteHeight = useSharedValue(defaultPaletteHeight);
    const handlePaletteHeightChange = useCallback((height: number) => {
        paletteWasResized.current = true;
        // the palette animates its visible height to match
        setPaletteHeight(clampPaletteHeight(height, 0));
    }, []);
    const usedTagIds = useMemo(
        () => collectUsedTagIds(conditions),
        [conditions],
    );
    const scroll = useScreenScroll();
    const scrollOffset = useScrollOffset(scroll.ref);
    const [constraintDraft, setConstraintDraft] = useState<
        | { kind: "add"; tag: Tag; suggested: boolean; target: DropTarget }
        | { kind: "edit"; queryTag: QueryTag }
        | null
    >(null);
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
            if (!pendingTag) return;
            if (pendingTag.tag.type === "basic") {
                setConditions((current) =>
                    addTagToCondition(
                        current,
                        pendingTag.tag,
                        conditionId,
                        pendingTag.suggested,
                    ),
                );
            } else {
                setConstraintDraft({
                    kind: "add",
                    tag: pendingTag.tag,
                    suggested: pendingTag.suggested,
                    target: { kind: "condition", conditionId },
                });
            }
            setPendingTag(null);
        },
        [pendingTag, setConditions, setPendingTag],
    );
    const placeTagInNewCondition = useCallback(() => {
        if (!pendingTag) return;
        if (pendingTag.tag.type === "basic") {
            setConditions((current) =>
                appendTag(current, pendingTag.tag, pendingTag.suggested),
            );
        } else {
            setConstraintDraft({
                kind: "add",
                tag: pendingTag.tag,
                suggested: pendingTag.suggested,
                target: { kind: "query-end" },
            });
        }
        setPendingTag(null);
    }, [pendingTag, setConditions, setPendingTag]);
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
                pendingTag,
                placeTagInCondition,
                placeTagInNewCondition,
            }}
        >
            <DragProvider onDrop={handleDrop} bottomInset={playerBottomInset}>
                <View
                    className="flex-1"
                    style={
                        headingOverlapHeight
                            ? { marginTop: -headingOverlapHeight }
                            : undefined
                    }
                >
                    <QueryDropViewport
                        scrollY={scrollOffset}
                        visibleHeight={visiblePaletteHeight}
                        topInset={headingOverlapHeight}
                    >
                        <ScreenScrollMarker>
                            <Animated.ScrollView
                                {...scroll}
                                removeClippedSubviews={false}
                                className="flex-1"
                                contentContainerClassName="flex-grow px-[18px]"
                                contentContainerStyle={{
                                    paddingTop: headingOverlapHeight,
                                    paddingBottom:
                                        paletteHeight + PALETTE_CLEARANCE,
                                }}
                                keyboardShouldPersistTaps="handled"
                            >
                                <ConditionList
                                    scrollRef={scroll.ref}
                                    scrollOffset={scrollOffset}
                                    viewportTopInset={headingOverlapHeight}
                                    viewportBottomInset={visiblePaletteHeight}
                                    bottomClearance={
                                        paletteHeight + PALETTE_CLEARANCE
                                    }
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
                        {conditions.length === 0 ? (
                            <EmptyQueryHint
                                topInset={headingOverlapHeight}
                                visibleHeight={visiblePaletteHeight}
                            />
                        ) : null}
                        <FloatingActions
                            historyAction={historyAction}
                            resultsAction={resultsAction}
                            visibleHeight={visiblePaletteHeight}
                        />
                    </QueryDropViewport>

                    {/* The palette raises itself for its search field, so
                        nothing here avoids the keyboard. Shrinking this view
                        would squeeze the workspace against the top. */}
                    <View
                        pointerEvents="box-none"
                        className="absolute inset-0 overflow-hidden"
                    >
                        <TagPalette
                            tags={tags}
                            tagMetadata={tagMetadata}
                            height={paletteHeight}
                            visibleHeight={visiblePaletteHeight}
                            onHeightChange={handlePaletteHeightChange}
                            includeSuggestedTags={includeSuggestedTags}
                            showAdvancedTags={showAdvancedTags}
                            showMetadataTags={showMetadataTags}
                            pendingTag={pendingTag}
                            onTagTap={selectPaletteTag}
                            usedTagIds={usedTagIds}
                        />
                    </View>
                </View>
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

function QueryDropViewport({
    children,
    scrollY,
    visibleHeight,
    topInset,
}: {
    children: ReactNode;
    scrollY: SharedValue<number>;
    visibleHeight: SharedValue<number>;
    topInset: number;
}) {
    useRefreshDragHover(scrollY, visibleHeight);
    return (
        <DropViewport
            className="flex-1"
            scrollY={scrollY}
            topInset={topInset}
            bottomInset={visibleHeight}
        >
            {children}
        </DropViewport>
    );
}

/**
 * The empty query's prompt, centered in the space between the heading and the
 * palette. It sits over the workspace rather than in its scroll content, and
 * moves only by transform from the palette's live height. Tied to the scroll
 * padding, it showed a frame in the wrong spot each time the padding changed.
 */
function EmptyQueryHint({
    topInset,
    visibleHeight,
}: {
    topInset: number;
    visibleHeight: SharedValue<number>;
}) {
    const style = useAnimatedStyle(() => ({
        transform: [
            {
                translateY:
                    (topInset - visibleHeight.get() - PALETTE_CLEARANCE) / 2,
            },
        ],
    }));
    return (
        <Animated.View
            pointerEvents="none"
            className="absolute inset-0 items-center justify-center px-[18px]"
            style={style}
        >
            <Text className="px-4 py-8 text-center text-sm text-muted-foreground">
                Drag a tag here to start.
            </Text>
        </Animated.View>
    );
}

function FloatingActions({
    historyAction,
    resultsAction,
    visibleHeight,
}: {
    historyAction: ReactNode;
    resultsAction: ReactNode;
    visibleHeight: SharedValue<number>;
}) {
    const { dragState } = useDrag();
    const positionStyle = useAnimatedStyle(() => ({
        transform: [
            { translateY: TAG_PALETTE_MAX_HEIGHT - visibleHeight.get() },
        ],
    }));
    if (dragState) return null;
    return (
        <Animated.View
            pointerEvents="box-none"
            className="absolute right-5 left-5 flex-row items-start justify-between"
            style={[{ bottom: TAG_PALETTE_MAX_HEIGHT + 12 }, positionStyle]}
        >
            <View>{historyAction}</View>
            {resultsAction}
        </Animated.View>
    );
}

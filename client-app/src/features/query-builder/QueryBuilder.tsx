import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from "react";
import { KeyboardAvoidingView, Platform, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import Animated from "react-native-reanimated";

import { GlassToggle } from "@/components/ui/glass-toggle";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import type { Tag } from "@/lib/types";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { useScreenScroll } from "@/lib/screen-scroll";
import { useColorScheme } from "nativewind";
import { ConditionList } from "./ConditionList";
import { DragGhost } from "./DragGhost";
import { DragProvider } from "./DragContext";
import {
    addTagToCondition,
    appendTag,
    insertTag,
    moveConditionToIndex,
    moveQueryTagToCondition,
    moveQueryTagToIndex,
    queryHeading,
    removeCondition,
    removeQueryTag,
    setGroupMode,
    toggleConditionConnector,
    toggleTagNegation,
} from "./QueryUtils";
import { TagPalette } from "./TagPalette";
import type {
    DragPayload,
    DropTarget,
    QueryCondition,
    QueryGroupMode,
} from "./types";

type Props = {
    tags: Tag[];
    conditions: QueryCondition[];
    setConditions: Dispatch<SetStateAction<QueryCondition[]>>;
    includeSuggestedTags: boolean;
    setIncludeSuggestedTags: Dispatch<SetStateAction<boolean>>;
};
const DEFAULT_PALETTE_HEIGHT = 208;

export function QueryBuilder({
    tags,
    conditions,
    setConditions,
    includeSuggestedTags,
    setIncludeSuggestedTags,
}: Props) {
    const { compactPlayerVisible, playerBottomInset } =
        useScreenOverlayInsets();
    const defaultPaletteHeight =
        DEFAULT_PALETTE_HEIGHT + (compactPlayerVisible ? playerBottomInset : 0);
    const paletteWasResized = useRef(false);
    const [paletteHeight, setPaletteHeight] = useState(defaultPaletteHeight);
    const { colorScheme = "light" } = useColorScheme();
    const theme = THEME[colorScheme];
    const scroll = useScreenScroll();
    useEffect(() => {
        if (!paletteWasResized.current) {
            setPaletteHeight(defaultPaletteHeight);
        }
    }, [defaultPaletteHeight]);
    const handlePaletteHeightChange = useCallback((height: number) => {
        paletteWasResized.current = true;
        setPaletteHeight(height);
    }, []);
    const handleDrop = useCallback(
        (payload: DragPayload, target: DropTarget) => {
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
                        );
                    }
                    if (target.kind === "insert") {
                        return insertTag(current, payload.tag, target.index);
                    }
                    if (target.kind === "query-end") {
                        return appendTag(current, payload.tag);
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
        [setConditions],
    );
    const toggleNegation = useCallback(
        (id: string) =>
            setConditions((current) => toggleTagNegation(current, id)),
        [setConditions],
    );
    const changeMode = useCallback(
        (id: string, mode: QueryGroupMode) =>
            setConditions((current) => setGroupMode(current, id, mode)),
        [setConditions],
    );
    const toggleConnector = useCallback(
        (id: string) =>
            setConditions((current) => toggleConditionConnector(current, id)),
        [setConditions],
    );

    return (
        <DragProvider onDrop={handleDrop}>
            <KeyboardAvoidingView
                className="flex-1 bg-background"
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                keyboardVerticalOffset={80}
            >
                <View className="flex-1 bg-background">
                    <View className="flex-row items-center gap-3 px-4 pt-2">
                        <Ionicons
                            name="sparkles-outline"
                            size={17}
                            color={theme.mutedForeground}
                        />
                        <Text className="flex-1 text-sm font-medium text-muted-foreground">
                            Include suggested tags
                        </Text>
                        <GlassToggle
                            value={includeSuggestedTags}
                            onValueChange={setIncludeSuggestedTags}
                            accessibilityLabel="Include suggested tags"
                        />
                    </View>
                    <View className="flex-row items-center px-4 pb-1 pt-2">
                        <Text className="flex-1 text-lg font-bold">
                            {queryHeading(conditions)}
                        </Text>
                        {conditions.length ? (
                            <Pressable
                                onPress={() => setConditions([])}
                                className="h-8 w-8 items-center justify-center rounded-full active:bg-accent"
                                accessibilityRole="button"
                                accessibilityLabel="Clear query"
                            >
                                <Ionicons
                                    name="refresh-outline"
                                    size={19}
                                    color={theme.mutedForeground}
                                />
                            </Pressable>
                        ) : null}
                    </View>
                    <ScreenScrollMarker>
                        <Animated.ScrollView
                            {...scroll}
                            className="flex-1"
                            contentContainerClassName="flex-grow px-4 pb-2"
                            keyboardShouldPersistTaps="handled"
                        >
                            <ConditionList
                                conditions={conditions}
                                onToggleNegation={toggleNegation}
                                onModeChange={changeMode}
                                onConnectorToggle={toggleConnector}
                            />
                        </Animated.ScrollView>
                    </ScreenScrollMarker>
                </View>

                <TagPalette
                    tags={tags}
                    height={paletteHeight}
                    onHeightChange={handlePaletteHeightChange}
                />
            </KeyboardAvoidingView>
            <DragGhost />
        </DragProvider>
    );
}

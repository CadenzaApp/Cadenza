import { GlassButton } from "@/components/ui/glass-button";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { GlassSurface } from "@/components/ui/glass-surface";
import { NebulaBackdrop } from "@/components/ui/nebula-backdrop";
import { Text } from "@/components/ui/text";
import { AdvancedQueryBuilder } from "@/features/advanced-query-builder/AdvancedQueryBuilder";
import { buildAdvancedQuery } from "@/features/advanced-query-builder/AdvancedQueryUtils";
import { QuerySegmentedControl } from "@/features/query-builder/GroupModeControl";
import { QueryBuilder } from "@/features/query-builder/QueryBuilder";
import {
    advancedUsesTags,
    withOuterConnector,
} from "@/features/query-builder/QueryConversion";
import {
    hasSuggestedTag,
    queryToJSON,
    sortTagsByApplicationCount,
} from "@/features/query-builder/QueryUtils";
import { ResultsSummary } from "@/features/query-builder/ResultsSummary";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { useOpenScreen } from "@/lib/open-screen";
import { describeQuery, positiveQueryTagNames } from "@/lib/query-json";
import { useQueryResults } from "@/lib/routes/queries";
import { useActivityTags, useUserTags } from "@/lib/routes/tags";
import { THEME } from "@/lib/theme";
import type { Tag } from "@/lib/types";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { useNavigation } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useColorScheme } from "nativewind";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Platform,
    Pressable,
    StyleSheet,
    View,
} from "react-native";
import Animated, {
    LinearTransition,
    ReduceMotion,
} from "react-native-reanimated";
import { HistoryActionButton, QuerySettingsDialog } from "./query-controls";
import { useQuerySettings } from "./query-settings";
import { switchQueryMode } from "./query-workspace";
import { useQueryWorkspace } from "./use-query-workspace";
import { useTagPlacement } from "./use-tag-placement";

const EMPTY_TAGS: Tag[] = [];
const OUTER_OPTIONS = [
    { value: "and", label: "all" },
    { value: "or", label: "any" },
] as const;

export function CadenzaScreen() {
    const { userTags, userTagsMeta, userTagsLoading, userTagsErr } =
        useUserTags();
    const { activityTags } = useActivityTags();
    const { isConnected } = useAppleMusic();
    const navigation = useNavigation();
    const { colors } = useTheme();
    const { colorScheme = "light" } = useColorScheme();
    const headingBackground = THEME[colorScheme].background;
    const openScreen = useOpenScreen();
    const {
        history,
        dispatch,
        workspace,
        edit,
        navigate,
        setConditions,
        setAdvancedRoot,
    } = useQueryWorkspace();
    const [headingHeight, setHeadingHeight] = useState(0);
    const {
        mode,
        conditions,
        advancedRoot,
        connector,
        includeSuggested,
        suggestedTags,
    } = workspace;
    const { activePendingTag, setPendingTag, placementTouches } =
        useTagPlacement(mode, conditions);
    const { settings, setSetting } = useQuerySettings(
        includeSuggested,
        dispatch,
    );
    const {
        showVennDiagrams,
        showUndoRedo,
        showAdvancedTags,
        showMetadataTags,
    } = settings;
    const [settingsOpen, setSettingsOpen] = useState(false);
    const queryTags = useMemo(
        () => [
            ...new Map(
                [...(userTags ?? []), ...suggestedTags].map((tag) => [
                    tag.id,
                    tag,
                ]),
            ).values(),
        ],
        [userTags, suggestedTags],
    );
    const allTags = useMemo(
        () => [...queryTags, ...(activityTags ?? [])],
        [queryTags, activityTags],
    );
    const tagTypes = useMemo(
        () => new Map(allTags.map((tag) => [tag.id, tag.type])),
        [allTags],
    );
    const suggestedIds = useMemo(
        () => new Set(suggestedTags.map((tag) => tag.id)),
        [suggestedTags],
    );
    const suggestedRequired =
        hasSuggestedTag(conditions) ||
        advancedUsesTags(advancedRoot, suggestedIds);
    const advancedBuild = useMemo(
        () => buildAdvancedQuery(advancedRoot, tagTypes),
        [advancedRoot, tagTypes],
    );
    const query = useMemo(
        () =>
            mode === "simple"
                ? queryToJSON(conditions)
                : advancedBuild.ok
                  ? advancedBuild.query
                  : null,
        [mode, conditions, advancedBuild],
    );
    const {
        matchedSongIds,
        queryResultsLoading,
        queryResultsErr,
        refreshQueryResults,
    } = useQueryResults(query, includeSuggested);
    const relevantTagNames = useMemo(
        () => (query ? positiveQueryTagNames(query, allTags) : []),
        [query, allTags],
    );
    const nebula = useMemo(() => {
        const colors = [
            ...new Set(
                sortTagsByApplicationCount(userTags ?? [], userTagsMeta).map(
                    (tag) => tag.color,
                ),
            ),
        ].slice(0, 5);
        return colors.length ? colors : ["#6466b8", "#257a83"];
    }, [userTags, userTagsMeta]);

    const toggleBuilder = useCallback(() => {
        setPendingTag(null);
        navigate(switchQueryMode);
    }, [setPendingTag, navigate]);

    useLayoutEffect(() => {
        navigation.setOptions({
            headerRight: () => (
                <View className="flex-row items-center gap-2">
                    <GlassButton
                        className="h-8 rounded-full px-2.5"
                        onPress={toggleBuilder}
                        accessibilityLabel={
                            mode === "simple"
                                ? "Open Advanced query editor"
                                : "Open Simple query editor"
                        }
                    >
                        <Text
                            numberOfLines={1}
                            className="text-sm font-semibold"
                        >
                            {mode === "simple" ? "Advanced" : "Simple"}
                        </Text>
                    </GlassButton>
                    <GlassIconButton
                        onPress={() => {
                            if (activePendingTag) setPendingTag(null);
                            else setSettingsOpen(true);
                        }}
                        accessibilityLabel="Query settings"
                    >
                        <Ionicons
                            name="options-outline"
                            size={20}
                            color={colors.text}
                        />
                    </GlassIconButton>
                </View>
            ),
        });
    }, [
        navigation,
        colors.text,
        mode,
        toggleBuilder,
        activePendingTag,
        setPendingTag,
    ]);

    const resultsAction = (
        <ResultsSummary
            count={matchedSongIds.length}
            loading={queryResultsLoading}
            error={queryResultsErr}
            hasQuery={query !== null}
            isLibraryConnected={isConnected}
            invalidMessage={
                mode === "advanced" && !advancedBuild.ok
                    ? advancedBuild.error
                    : null
            }
            onRetry={() => {
                if (activePendingTag) {
                    setPendingTag(null);
                    return;
                }
                void refreshQueryResults();
            }}
            onNext={() => {
                if (activePendingTag) {
                    setPendingTag(null);
                    return;
                }
                if (!query || queryResultsLoading || queryResultsErr) return;
                openScreen({
                    pathname: "/query-results",
                    params: {
                        query: JSON.stringify(query),
                        suggested: includeSuggested ? "1" : "",
                        relevantTags: JSON.stringify(relevantTagNames),
                        name: describeQuery(query, allTags),
                    },
                });
            }}
        />
    );

    const historyAction = showUndoRedo ? (
        <View
            className={
                Platform.OS === "ios"
                    ? "h-9 flex-row items-center overflow-hidden rounded-full border border-border"
                    : "flex-row items-center gap-2"
            }
        >
            {Platform.OS === "ios" ? (
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <GlassSurface style={StyleSheet.absoluteFill} />
                </View>
            ) : null}
            <HistoryActionButton
                icon="arrow-undo"
                label="Undo query change"
                grouped={Platform.OS === "ios"}
                disabled={history.past.length === 0}
                onPress={() => {
                    if (activePendingTag) setPendingTag(null);
                    else dispatch({ type: "undo" });
                }}
            />
            {Platform.OS === "ios" ? (
                <View className="h-5 border-l border-border" />
            ) : null}
            <HistoryActionButton
                icon="arrow-redo"
                label="Redo query change"
                grouped={Platform.OS === "ios"}
                disabled={history.future.length === 0}
                onPress={() => {
                    if (activePendingTag) setPendingTag(null);
                    else dispatch({ type: "redo" });
                }}
            />
        </View>
    ) : null;

    return (
        <View className="flex-1 bg-background" {...placementTouches}>
            <View pointerEvents="none" className="absolute inset-0 opacity-50">
                <NebulaBackdrop colors={nebula} />
            </View>
            {userTagsLoading ? (
                <View className="flex-1 items-center justify-center">
                    <ActivityIndicator accessibilityLabel="Loading tags" />
                </View>
            ) : userTagsErr ? (
                <View className="flex-1 items-center justify-center px-6">
                    <Text className="text-sm">
                        Your tags could not be loaded.
                    </Text>
                </View>
            ) : (
                <>
                    <View
                        onLayout={(event) =>
                            setHeadingHeight(event.nativeEvent.layout.height)
                        }
                        style={mode === "simple" ? { zIndex: 2 } : undefined}
                    >
                        <Animated.View
                            layout={LinearTransition.duration(180).reduceMotion(
                                ReduceMotion.System,
                            )}
                            className="min-h-9 flex-row items-start justify-between gap-2 px-[18px] pb-3 pt-4"
                        >
                            <LinearGradient
                                pointerEvents="none"
                                colors={[
                                    headingBackground,
                                    `${headingBackground}B3`,
                                    `${headingBackground}00`,
                                ]}
                                locations={[0, 0.5, 1]}
                                start={{ x: 0.5, y: 0 }}
                                end={{ x: 0.5, y: 1 }}
                                style={[
                                    StyleSheet.absoluteFill,
                                    { bottom: -16 },
                                ]}
                            />
                            {mode === "simple" && conditions.length > 1 ? (
                                <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                    {"Find me all songs that satisfy"
                                        .split(" ")
                                        .map((word, index) => (
                                            <Text
                                                key={`intro-${index}`}
                                                className="text-xl font-bold"
                                            >
                                                {word}
                                            </Text>
                                        ))}
                                    <View
                                        pointerEvents={
                                            activePendingTag ? "none" : "auto"
                                        }
                                    >
                                        <QuerySegmentedControl
                                            value={connector}
                                            options={OUTER_OPTIONS}
                                            onChange={(next) =>
                                                edit((current) => ({
                                                    ...current,
                                                    connector: next,
                                                    conditions:
                                                        withOuterConnector(
                                                            current.conditions,
                                                            next,
                                                        ),
                                                }))
                                            }
                                            label="Match groups"
                                            optionTextClassName="text-xl font-bold text-foreground"
                                            segmentWidth={56}
                                        />
                                    </View>
                                    {"of the following:"
                                        .split(" ")
                                        .map((word, index) => (
                                            <Text
                                                key={`outro-${index}`}
                                                className="text-xl font-bold"
                                            >
                                                {word}
                                            </Text>
                                        ))}
                                </View>
                            ) : (
                                <Text className="min-w-0 flex-1 text-xl font-bold">
                                    {mode === "simple"
                                        ? "Find me all songs that"
                                        : "Advanced filters"}
                                </Text>
                            )}
                            {(
                                mode === "simple"
                                    ? conditions.length > 0
                                    : advancedRoot.children.length > 0
                            ) ? (
                                <Pressable
                                    disabled={!!activePendingTag}
                                    className="h-8 w-8 items-center justify-center"
                                    hitSlop={6}
                                    accessibilityRole="button"
                                    accessibilityLabel="Clear query"
                                    onPress={() =>
                                        edit((current) =>
                                            current.mode === "simple"
                                                ? { ...current, conditions: [] }
                                                : {
                                                      ...current,
                                                      advancedRoot: {
                                                          ...current.advancedRoot,
                                                          children: [],
                                                      },
                                                  },
                                        )
                                    }
                                >
                                    <Ionicons
                                        name="refresh-outline"
                                        size={19}
                                        color={colors.text}
                                    />
                                </Pressable>
                            ) : null}
                        </Animated.View>
                    </View>
                    {mode === "simple" ? (
                        <QueryBuilder
                            headingOverlapHeight={headingHeight}
                            resultsAction={resultsAction}
                            historyAction={historyAction}
                            pendingTag={activePendingTag}
                            setPendingTag={setPendingTag}
                            showVennDiagrams={showVennDiagrams}
                            showAdvancedTags={showAdvancedTags}
                            showMetadataTags={showMetadataTags}
                            tags={userTags ?? []}
                            tagMetadata={userTagsMeta}
                            conditions={conditions}
                            setConditions={setConditions}
                            includeSuggestedTags={includeSuggested}
                            outerConnector={connector}
                            onOuterConnectorChange={(next) =>
                                edit((current) => ({
                                    ...current,
                                    connector: next,
                                    conditions: withOuterConnector(
                                        current.conditions,
                                        next,
                                    ),
                                }))
                            }
                        />
                    ) : (
                        <AdvancedQueryBuilder
                            resultsAction={resultsAction}
                            historyAction={historyAction}
                            tags={
                                includeSuggested
                                    ? queryTags
                                    : (userTags ?? EMPTY_TAGS)
                            }
                            activityTags={activityTags ?? EMPTY_TAGS}
                            root={advancedRoot}
                            setRoot={setAdvancedRoot}
                            message={
                                advancedBuild.ok ? null : advancedBuild.error
                            }
                        />
                    )}
                </>
            )}
            <QuerySettingsDialog
                visible={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                settings={settings}
                onChange={setSetting}
                suggestedRequired={suggestedRequired}
            />
        </View>
    );
}

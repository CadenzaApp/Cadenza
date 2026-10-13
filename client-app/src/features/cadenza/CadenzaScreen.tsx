import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
    type ReactNode,
    type SetStateAction,
} from "react";
import {
    ActivityIndicator,
    Platform,
    Pressable,
    StyleSheet,
    View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
    LinearTransition,
    ReduceMotion,
} from "react-native-reanimated";
import { useNavigation } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useColorScheme } from "nativewind";
import { ModalPopup } from "@/components/custom/modal-popup";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { GlassSurface } from "@/components/ui/glass-surface";
import { GlassToggle } from "@/components/ui/glass-toggle";
import { NebulaBackdrop } from "@/components/ui/nebula-backdrop";
import { Text } from "@/components/ui/text";
import { AdvancedQueryBuilder } from "@/features/advanced-query-builder/AdvancedQueryBuilder";
import {
    buildAdvancedQuery,
    createGroup,
} from "@/features/advanced-query-builder/AdvancedQueryUtils";
import type { AdvancedGroupNode } from "@/features/advanced-query-builder/types";
import { QueryBuilder } from "@/features/query-builder/QueryBuilder";
import {
    hasSuggestedTag,
    queryToJSON,
    sortTagsByApplicationCount,
} from "@/features/query-builder/QueryUtils";
import {
    advancedToSimple,
    advancedUsesTags,
    simpleToAdvanced,
    withOuterConnector,
} from "@/features/query-builder/QueryConversion";
import { ResultsSummary } from "@/features/query-builder/ResultsSummary";
import { QuerySegmentedControl } from "@/features/query-builder/GroupModeControl";
import type { QueryCondition } from "@/features/query-builder/types";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { describeQuery, positiveQueryTagNames } from "@/lib/query-json";
import { useQueryResults } from "@/lib/routes/queries";
import { useActivityTags, useUserTags } from "@/lib/routes/tags";
import { useScoreQueryTags } from "@/lib/tag-scores";
import type { Tag } from "@/lib/types";
import { useOpenScreen } from "@/lib/open-screen";
import { THEME } from "@/lib/theme";
import { workspaceReducer, type QueryWorkspace } from "./query-workspace";
import {
    DEFAULT_QUERY_SETTINGS,
    loadQuerySettings,
    saveQuerySettings,
} from "./query-settings";

const EMPTY_TAGS: Tag[] = [];
const OUTER_OPTIONS = [
    { value: "and", label: "all" },
    { value: "or", label: "any" },
] as const;
const INITIAL_WORKSPACE: QueryWorkspace = {
    mode: "simple",
    conditions: [],
    connector: "and",
    advancedRoot: {
        kind: "group",
        id: "initial-root",
        conjunction: "and",
        children: [],
    },
    advancedDetached: false,
    includeSuggested: DEFAULT_QUERY_SETTINGS.includeSuggested,
    suggestedTags: [],
};

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
    const scoreQueryTags = useScoreQueryTags();
    const [history, dispatch] = useReducer(workspaceReducer, {
        present: INITIAL_WORKSPACE,
        past: [],
        future: [],
        suspended: {
            simple: { past: [], future: [] },
            advanced: { past: [], future: [] },
        },
    });
    const [headingHeight, setHeadingHeight] = useState(0);
    const [pendingTag, setPendingTag] = useState<{
        tag: Tag;
        suggested: boolean;
        conditionIds: string[];
    } | null>(null);
    const placementTouchStart = useRef<{
        x: number;
        y: number;
        time: number;
        moved: boolean;
    } | null>(null);
    const workspace = history.present;
    const {
        mode,
        conditions,
        advancedRoot,
        connector,
        includeSuggested,
        suggestedTags,
    } = workspace;
    const activePendingTag =
        mode === "simple" &&
        pendingTag &&
        conditions.some((condition) =>
            pendingTag.conditionIds.includes(condition.id),
        )
            ? pendingTag
            : null;
    const [showVennDiagrams, setShowVennDiagrams] = useState(
        DEFAULT_QUERY_SETTINGS.showVennDiagrams,
    );
    const [showUndoRedo, setShowUndoRedo] = useState(
        DEFAULT_QUERY_SETTINGS.showUndoRedo,
    );
    const [showAdvancedTags, setShowAdvancedTags] = useState(
        DEFAULT_QUERY_SETTINGS.showAdvancedTags,
    );
    const [showMetadataTags, setShowMetadataTags] = useState(
        DEFAULT_QUERY_SETTINGS.showMetadataTags,
    );
    const [settingsRestored, setSettingsRestored] = useState(false);
    const changedDuringRestore = useRef({
        includeSuggested: false,
        showVennDiagrams: false,
        showUndoRedo: false,
        showAdvancedTags: false,
        showMetadataTags: false,
    });
    const settingsSaveQueue = useRef(Promise.resolve());
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsHelp, setSettingsHelp] = useState<string | null>(null);
    const [switchDialog, setSwitchDialog] = useState<
        "simple" | "advanced" | null
    >(null);
    useEffect(
        () => navigation.addListener("blur", () => setPendingTag(null)),
        [navigation],
    );
    const edit = useCallback(
        (update: (value: QueryWorkspace) => QueryWorkspace) =>
            dispatch({ type: "edit", update }),
        [],
    );
    const navigate = useCallback(
        (
            update: (value: QueryWorkspace) => QueryWorkspace,
            resetDestinationHistory = false,
        ) => dispatch({ type: "navigate", update, resetDestinationHistory }),
        [],
    );
    useEffect(() => {
        let active = true;
        void loadQuerySettings()
            .then((saved) => {
                if (!active) return;
                if (!changedDuringRestore.current.includeSuggested) {
                    dispatch({
                        type: "restore-settings",
                        includeSuggested: saved.includeSuggested,
                    });
                }
                if (!changedDuringRestore.current.showVennDiagrams) {
                    setShowVennDiagrams(saved.showVennDiagrams);
                }
                if (!changedDuringRestore.current.showUndoRedo) {
                    setShowUndoRedo(saved.showUndoRedo);
                }
                if (!changedDuringRestore.current.showAdvancedTags) {
                    setShowAdvancedTags(saved.showAdvancedTags);
                }
                if (!changedDuringRestore.current.showMetadataTags) {
                    setShowMetadataTags(saved.showMetadataTags);
                }
            })
            .catch((error) =>
                console.error("Failed to restore query settings:", error),
            )
            .finally(() => {
                if (active) setSettingsRestored(true);
            });
        return () => {
            active = false;
        };
    }, []);
    useEffect(() => {
        if (!settingsRestored) return;
        const settings = {
            includeSuggested,
            showVennDiagrams,
            showUndoRedo,
            showAdvancedTags,
            showMetadataTags,
        };
        settingsSaveQueue.current = settingsSaveQueue.current
            .then(() => saveQuerySettings(settings))
            .catch((error) =>
                console.error("Failed to save query settings:", error),
            );
    }, [
        settingsRestored,
        includeSuggested,
        showVennDiagrams,
        showUndoRedo,
        showAdvancedTags,
        showMetadataTags,
    ]);
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

    const setConditions = useCallback(
        (update: SetStateAction<QueryCondition[]>) =>
            edit((current) => {
                const next =
                    typeof update === "function"
                        ? update(current.conditions)
                        : update;
                const newSuggested = next
                    .flatMap((condition) =>
                        condition.kind === "tag"
                            ? [condition]
                            : condition.members,
                    )
                    .filter((tag) => tag.suggested)
                    .map((tag) => tag.tag);
                return {
                    ...current,
                    conditions: withOuterConnector(next, current.connector),
                    suggestedTags: [
                        ...new Map(
                            [...current.suggestedTags, ...newSuggested].map(
                                (tag) => [tag.id, tag],
                            ),
                        ).values(),
                    ],
                };
            }),
        [edit],
    );
    const setAdvancedRoot = useCallback(
        (update: (root: AdvancedGroupNode) => AdvancedGroupNode) =>
            edit((current) => ({
                ...current,
                advancedRoot: update(current.advancedRoot),
            })),
        [edit],
    );

    const openAdvanced = useCallback(() => {
        let root = simpleToAdvanced(conditions);
        if (!root.children.length) root = createGroup();
        const converted = buildAdvancedQuery(root, tagTypes);
        const shouldResetHistory =
            !converted.ok ||
            !advancedBuild.ok ||
            JSON.stringify(converted.query) !==
                JSON.stringify(advancedBuild.query);
        navigate(
            (current) => ({
                ...current,
                mode: "advanced",
                advancedRoot: root,
                advancedDetached: false,
            }),
            shouldResetHistory,
        );
        setSwitchDialog(null);
    }, [navigate, tagTypes, conditions, advancedBuild]);
    const requestAdvanced = useCallback(() => {
        if (workspace.advancedDetached) {
            setSwitchDialog("advanced");
        } else openAdvanced();
    }, [workspace.advancedDetached, openAdvanced]);
    const toggleBuilder = useCallback(() => {
        if (activePendingTag) {
            setPendingTag(null);
            return;
        }
        setPendingTag(null);
        if (mode === "simple") {
            requestAdvanced();
            return;
        }
        const simple = advancedToSimple(advancedRoot, allTags, suggestedIds);
        if (!simple) {
            setSwitchDialog("simple");
            return;
        }
        const sameSimpleQuery =
            JSON.stringify(queryToJSON(simple.conditions)) ===
            JSON.stringify(queryToJSON(conditions));
        navigate(
            (current) => ({
                ...current,
                mode: "simple",
                conditions: simple.conditions,
                connector: simple.connector,
                advancedDetached: false,
            }),
            !sameSimpleQuery,
        );
    }, [
        activePendingTag,
        mode,
        requestAdvanced,
        advancedRoot,
        allTags,
        suggestedIds,
        conditions,
        navigate,
    ]);

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
                void scoreQueryTags(
                    query,
                    queryTags.filter((tag) => !tag.is_activity),
                );
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
        <View
            className="flex-1 bg-background"
            onTouchStart={(event) => {
                const { pageX, pageY } = event.nativeEvent;
                placementTouchStart.current = {
                    x: pageX,
                    y: pageY,
                    time: Date.now(),
                    moved: false,
                };
            }}
            onTouchMove={(event) => {
                const start = placementTouchStart.current;
                if (!start) return;
                const { pageX, pageY } = event.nativeEvent;
                if (
                    Math.abs(pageX - start.x) >= 10 ||
                    Math.abs(pageY - start.y) >= 10
                ) {
                    start.moved = true;
                }
            }}
            onTouchEnd={(event) => {
                const start = placementTouchStart.current;
                placementTouchStart.current = null;
                if (!activePendingTag || !start) return;
                const { pageX, pageY } = event.nativeEvent;
                if (
                    !start.moved &&
                    Math.abs(pageX - start.x) < 10 &&
                    Math.abs(pageY - start.y) < 10 &&
                    Date.now() - start.time < 700
                ) {
                    setPendingTag(null);
                }
            }}
            onTouchCancel={() => {
                placementTouchStart.current = null;
            }}
        >
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
                                    `${headingBackground}00`,
                                ]}
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
                        {workspace.advancedDetached && mode === "simple" ? (
                            <Text className="px-5 pt-2 text-sm text-muted-foreground">
                                Your advanced draft is kept. Open Advanced to
                                resume it.
                            </Text>
                        ) : null}
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
            <ModalPopup
                visible={settingsOpen}
                onClose={() => {
                    setSettingsOpen(false);
                    setSettingsHelp(null);
                }}
                title="Query settings"
                titleClassName="text-xl font-bold"
                contentStyle={{ width: "90%" }}
            >
                <View className="relative">
                    <QuerySettingRow
                        label="Show Venn diagrams"
                        help="Show a small diagram of how each tag group matches songs."
                        helpOpen={settingsHelp === "venn"}
                        onHelpPress={() =>
                            setSettingsHelp(
                                settingsHelp === "venn" ? null : "venn",
                            )
                        }
                    >
                        <GlassToggle
                            value={showVennDiagrams}
                            onValueChange={(value) => {
                                changedDuringRestore.current.showVennDiagrams = true;
                                setShowVennDiagrams(value);
                            }}
                            accessibilityLabel="Show Venn diagrams"
                        />
                    </QuerySettingRow>
                    <QuerySettingRow
                        label="Show undo/redo"
                        help="Show the undo and redo buttons beside the results button. Up to 15 query edits are kept."
                        helpOpen={settingsHelp === "history"}
                        onHelpPress={() =>
                            setSettingsHelp(
                                settingsHelp === "history" ? null : "history",
                            )
                        }
                    >
                        <GlassToggle
                            value={showUndoRedo}
                            onValueChange={(value) => {
                                changedDuringRestore.current.showUndoRedo = true;
                                setShowUndoRedo(value);
                            }}
                            accessibilityLabel="Show undo and redo"
                        />
                    </QuerySettingRow>
                    <QuerySettingRow
                        label="Show suggested tags"
                        helpPlacement="above"
                        help={
                            suggestedRequired
                                ? "Suggested tags appear in the palette and count when matching songs in either editor. Remove them from both query drafts before turning this off; your queries will not be cleared."
                                : "Show shared suggested tags in the palette and count them when matching songs in either editor."
                        }
                        helpOpen={settingsHelp === "suggested"}
                        onHelpPress={() =>
                            setSettingsHelp(
                                settingsHelp === "suggested"
                                    ? null
                                    : "suggested",
                            )
                        }
                    >
                        {suggestedRequired ? (
                            <Text
                                className="text-sm"
                                accessibilityLabel="Suggested tags required by a query draft"
                            >
                                On
                            </Text>
                        ) : (
                            <GlassToggle
                                value={includeSuggested}
                                onValueChange={(value) => {
                                    changedDuringRestore.current.includeSuggested = true;
                                    edit((current) => ({
                                        ...current,
                                        includeSuggested: value,
                                    }));
                                }}
                                accessibilityLabel="Show suggested tags"
                            />
                        )}
                    </QuerySettingRow>
                    <QuerySettingRow
                        label="Show advanced tags"
                        help="Show tags with text, number, date, time, or checkbox values in the Simple tag palette. Existing query tags stay in place when this is off."
                        helpOpen={settingsHelp === "advanced"}
                        onHelpPress={() =>
                            setSettingsHelp(
                                settingsHelp === "advanced" ? null : "advanced",
                            )
                        }
                    >
                        <GlassToggle
                            value={showAdvancedTags}
                            onValueChange={(value) => {
                                changedDuringRestore.current.showAdvancedTags = true;
                                setShowAdvancedTags(value);
                            }}
                            accessibilityLabel="Show advanced tags in tag palette"
                        />
                    </QuerySettingRow>
                    <QuerySettingRow
                        label="Show metadata tags"
                        help="Show song fields such as title, artist, release date, and duration in the Simple tag palette. Existing query filters stay in place when this is off."
                        helpOpen={settingsHelp === "metadata"}
                        onHelpPress={() =>
                            setSettingsHelp(
                                settingsHelp === "metadata" ? null : "metadata",
                            )
                        }
                    >
                        <GlassToggle
                            value={showMetadataTags}
                            onValueChange={(value) => {
                                changedDuringRestore.current.showMetadataTags = true;
                                setShowMetadataTags(value);
                            }}
                            accessibilityLabel="Show metadata tags in tag palette"
                        />
                    </QuerySettingRow>
                </View>
                <GlassButton
                    className="mt-3"
                    onPress={() => {
                        setSettingsOpen(false);
                        setSettingsHelp(null);
                    }}
                >
                    <Text className="text-sm">Done</Text>
                </GlassButton>
            </ModalPopup>
            <ModalPopup
                visible={switchDialog !== null}
                onClose={() => {
                    setSwitchDialog(null);
                }}
                title={
                    switchDialog === "simple"
                        ? "Keep advanced filters"
                        : "Open Advanced"
                }
                titleClassName="text-xl font-bold"
                contentStyle={{ width: "90%" }}
            >
                <Text className="text-sm text-muted-foreground">
                    {switchDialog === "simple"
                        ? "This query uses values or nested logic that Simple cannot represent. You can open your previous simple draft; this advanced query will be kept."
                        : "You have a separate advanced draft. Resume it, or replace it with your current simple query."}
                </Text>
                <GlassButton
                    onPress={() => {
                        if (switchDialog === "simple")
                            navigate((current) => ({
                                ...current,
                                mode: "simple",
                                advancedDetached: true,
                            }));
                        else
                            navigate((current) => ({
                                ...current,
                                mode: "advanced",
                            }));
                        setSwitchDialog(null);
                    }}
                >
                    <Text className="text-sm">
                        {switchDialog === "simple"
                            ? "Open previous simple draft"
                            : "Resume advanced draft"}
                    </Text>
                </GlassButton>
                {switchDialog === "advanced" ? (
                    <GlassButton onPress={() => openAdvanced()}>
                        <Text className="text-sm">
                            Use current simple query
                        </Text>
                    </GlassButton>
                ) : null}
                <GlassButton
                    onPress={() => {
                        setSwitchDialog(null);
                    }}
                >
                    <Text className="text-sm">Keep editing</Text>
                </GlassButton>
            </ModalPopup>
        </View>
    );
}

function QuerySettingRow({
    label,
    help,
    helpOpen,
    helpPlacement = "below",
    onHelpPress,
    children,
}: {
    label: string;
    help: string;
    helpOpen: boolean;
    helpPlacement?: "above" | "below";
    onHelpPress: () => void;
    children: ReactNode;
}) {
    const { colorScheme = "light" } = useColorScheme();
    return (
        <View className="py-2" style={{ zIndex: helpOpen ? 10 : 0 }}>
            <View className="min-h-11 flex-row items-center gap-1">
                <Text className="text-sm font-semibold">{label}</Text>
                <Pressable
                    onPress={onHelpPress}
                    accessibilityRole="button"
                    accessibilityLabel={`About ${label}`}
                    accessibilityState={{ expanded: helpOpen }}
                    className="h-8 w-8 items-center justify-center"
                    hitSlop={4}
                >
                    <Ionicons
                        name="information-circle-outline"
                        size={18}
                        color={THEME[colorScheme].mutedForeground}
                    />
                </Pressable>
                <View className="ml-auto">{children}</View>
            </View>
            {helpOpen ? (
                <View
                    className="absolute left-5 right-2 rounded-xl border border-border bg-popover px-3 py-2 shadow-lg"
                    style={{
                        [helpPlacement === "above" ? "bottom" : "top"]: 48,
                        elevation: 20,
                    }}
                >
                    <Text className="text-sm text-muted-foreground">
                        {help}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

function HistoryActionButton({
    icon,
    label,
    disabled,
    onPress,
    grouped = false,
}: {
    icon: "arrow-undo" | "arrow-redo";
    label: string;
    disabled: boolean;
    onPress: () => void;
    grouped?: boolean;
}) {
    const { colors } = useTheme();
    const content = (
        <View style={{ opacity: disabled ? 0.35 : 1 }}>
            <Ionicons name={icon} size={18} color={colors.text} />
        </View>
    );
    if (grouped) {
        return (
            <Pressable
                onPress={onPress}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ disabled }}
                className="h-9 w-9 items-center justify-center active:opacity-65"
            >
                {content}
            </Pressable>
        );
    }
    return (
        <GlassIconButton
            size={36}
            onPress={onPress}
            accessibilityLabel={label}
            accessibilityState={{ disabled }}
            disabled={disabled}
        >
            {content}
        </GlassIconButton>
    );
}

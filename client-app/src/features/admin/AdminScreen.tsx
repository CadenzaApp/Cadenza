import { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import {
    SafeAreaView,
    useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useSharedValue } from "react-native-reanimated";
import { AnalyticsCard } from "@/features/analytics/AnalyticsCard";
import { NebulaBackdrop } from "@/components/ui/nebula-backdrop";
import { GlassInput } from "@/components/ui/glass-input";
import { SlidingTabStrip } from "@/components/ui/sliding-tab-pager";
import { Text } from "@/components/ui/text";
import { useAnalyticsPeriod } from "@/features/analytics/analytics-period";
import { PeriodBar } from "@/features/analytics/PeriodControls";
import { formatCount } from "@/features/analytics/format";
import { useAppTheme } from "@/lib/theme";
import { useAPIData } from "@/lib/api-actions";
import {
    useAdminAccess,
    type AdminMetrics as Bundle,
} from "@/lib/routes/admin";
import {
    useAdminDivider,
    ADMIN_BLACK_OVERLAY,
    ScrubContext,
    Button,
    Metric,
    RankingLimit,
} from "./admin-ui";
import {
    adminNebulaPalette,
    chartDate,
    reportingBoundary,
} from "./admin-utils";
import { Graph, ListeningGraphs, SongEndingsChart } from "./AdminCharts";
import { Ranking } from "./AdminRankings";
import { AdminNavigation } from "./AdminNavigation";
import { TagDirectory } from "./TagDirectory";
export function AdminScreen() {
    const access = useAdminAccess();
    const { colors, scheme } = useAppTheme();
    const nebula = useMemo(
        () => adminNebulaPalette(colors.brand, scheme),
        [colors.brand, scheme],
    );
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const touchY = useRef(0);
    return (
        <SafeAreaView edges={[]} className="flex-1 bg-background">
            <NebulaBackdrop colors={nebula} layout="float" preserveColors />
            <View
                onTouchStart={(e) => {
                    touchY.current = e.nativeEvent.pageY;
                }}
                onMoveShouldSetResponder={(e) =>
                    e.nativeEvent.pageY - touchY.current > 15
                }
                onResponderRelease={(e) => {
                    if (e.nativeEvent.pageY - touchY.current > 70)
                        router.back();
                }}
                style={{
                    paddingTop: Math.max(12, insets.top) + 8,
                    backgroundColor: ADMIN_BLACK_OVERLAY,
                }}
                className="flex-row items-center justify-between px-5 pb-3"
            >
                <View>
                    <Text className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Cadenza
                    </Text>
                    <Text className="text-2xl font-bold">Admin</Text>
                </View>
                <Button label="Close" onPress={() => router.back()} />
            </View>
            {access.data?.dashboard && !access.error ? (
                <Dashboard />
            ) : (
                <Text className="p-5">
                    {access.isLoading
                        ? "Checking access…"
                        : "Admin access is unavailable."}
                </Text>
            )}
        </SafeAreaView>
    );
}
function Dashboard() {
    const insets = useSafeAreaInsets();
    const [navHeight, setNavHeight] = useState(140);
    const { period, setGrain } = useAnalyticsPeriod();
    const [scrubbing, setScrubbing] = useState(false);
    const scrollRef = useRef<ScrollView>(null);
    const lockScrolling = useCallback((locked: boolean) => {
        scrollRef.current?.setNativeProps({ scrollEnabled: !locked });
        setScrubbing(locked);
    }, []);
    const [listTab, setListTab] = useState("songs");
    const [scrubDay, setScrubDay] = useState<string | null>(null);
    const listProgress = useSharedValue(0);
    const [section, setSection] = useState("listening");
    const days = 30;
    const [limit, setLimit] = useState(10);
    const [search, setSearch] = useState("");
    const [sort, setSort] = useState("songs");
    const [descending, setDescending] = useState(true);
    const [page, setPage] = useState(0);
    const [defaults, setDefaults] = useState(false);
    const grain = period.grain;
    const offset = -period.offset;
    const read = useAPIData<Bundle>(
        "/admin/metrics",
        {
            kind: section === "users" ? grain : section,
            days,
            since: reportingBoundary(period.since),
            until: reportingBoundary(period.until),
            limit,
            search,
            sort,
            descending,
            offset: section === "tags" ? page : offset,
            defaults,
        },
        { refreshInterval: 60_000 },
    );
    const data = read.error ? undefined : read.data;
    const divider = useAdminDivider();
    const tagProgress = useSharedValue(defaults ? 1 : 0);
    const { colors } = useAppTheme();
    return (
        <ScrubContext.Provider value={lockScrolling}>
            <View className="flex-1">
                {(section === "listening" ||
                    section === "social" ||
                    section === "users") && (
                    <View
                        style={{
                            backgroundColor: ADMIN_BLACK_OVERLAY,
                            borderBottomColor: divider,
                        }}
                        className="border-b px-5 py-3"
                    >
                        <PeriodBar
                            grains={
                                section === "users"
                                    ? ["week", "month"]
                                    : section === "social"
                                      ? ["week", "month", "year"]
                                      : undefined
                            }
                        />
                    </View>
                )}
                <ScrollView
                    ref={scrollRef}
                    scrollEnabled={!scrubbing}
                    key={section}
                    className="flex-1"
                    contentContainerClassName="gap-6 px-5 pt-3"
                    contentContainerStyle={{ paddingBottom: navHeight + 24 }}
                    keyboardShouldPersistTaps="handled"
                >
                    <View className="gap-1">
                        <Text className="text-2xl font-bold">
                            {
                                {
                                    listening: "Listening trends",
                                    tags: "Tag directory",
                                    users: "Active users",
                                    social: "Social activity",
                                }[section]
                            }
                        </Text>
                        <Text className="text-xs text-muted-foreground">
                            Platform-wide · UTC · Today is incomplete
                        </Text>
                    </View>
                    {section === "tags" && (
                        <View className="gap-3">
                            <GlassInput
                                accessibilityLabel="Search tag names"
                                placeholder="Search tag names"
                                value={search}
                                onChangeText={(value) => {
                                    setSearch(value);
                                    setPage(0);
                                }}
                                placeholderTextColor={colors.mutedForeground}
                                autoCapitalize="none"
                                autoCorrect={false}
                                icon="search-outline"
                            />
                            <SlidingTabStrip
                                options={[
                                    { value: "user", label: "User tags" },
                                    {
                                        value: "suggested",
                                        label: "Suggested tags",
                                    },
                                ]}
                                value={defaults ? "suggested" : "user"}
                                progress={tagProgress}
                                onChange={(value) => {
                                    setDefaults(value === "suggested");
                                    setPage(0);
                                    tagProgress.set(
                                        value === "suggested" ? 1 : 0,
                                    );
                                }}
                            />
                        </View>
                    )}
                    {read.isLoading && <Text>Loading statistics…</Text>}
                    {read.error && (
                        <View className="gap-2">
                            <Text accessibilityRole="alert">
                                Could not load statistics. Access may have
                                changed.
                            </Text>
                            <Button
                                label="Retry"
                                onPress={() => void read.mutate()}
                            />
                        </View>
                    )}
                    {data && section === "listening" && (
                        <>
                            <ListeningGraphs
                                key={`${period.since}-${period.until}`}
                                days={data.trend?.days}
                                onScrub={setScrubDay}
                            />
                            <SongEndingsChart
                                rows={data.song_endings ?? []}
                                day={scrubDay}
                            />
                            <RankingLimit limit={limit} onChange={setLimit} />
                            <SlidingTabStrip
                                options={[
                                    { value: "songs", label: "Songs" },
                                    { value: "artists", label: "Artists" },
                                    { value: "tags", label: "Tags" },
                                ]}
                                value={listTab}
                                progress={listProgress}
                                onChange={(v) => {
                                    setListTab(v);
                                    listProgress.set(
                                        ["songs", "artists", "tags"].indexOf(v),
                                    );
                                }}
                            />
                            {listTab === "songs" && (
                                <Ranking
                                    title="Most listened-to songs"
                                    rows={data.songs}
                                />
                            )}
                            {listTab === "artists" && (
                                <Ranking
                                    title="Most listened-to artists"
                                    rows={data.artists}
                                />
                            )}
                            {listTab === "tags" && (
                                <Ranking
                                    title="Most listened-to tag names"
                                    rows={data.tags}
                                />
                            )}
                            {listTab === "tags" && (
                                <Text className="text-xs text-muted-foreground">
                                    Tags reflect current assignments. Tag totals
                                    overlap.
                                </Text>
                            )}
                            {listTab === "songs" && (
                                <Ranking
                                    title="The songs nobody likes"
                                    rows={data.skipped}
                                />
                            )}
                        </>
                    )}
                    {data && section === "social" && (
                        <>
                            <Graph
                                title="Total posts"
                                days={data.days}
                                field="posts"
                            />
                            <RankingLimit limit={limit} onChange={setLimit} />
                            <Ranking title="Top posts" rows={data.posts} />
                            <Text className="text-xs text-muted-foreground">
                                Spotlights excluded. Deleted posts and removed
                                likes are excluded.
                            </Text>
                        </>
                    )}
                    {section === "users" && (
                        <>
                            {data && (
                                <Graph
                                    title="Daily active users"
                                    days={data.days}
                                    field="active_users"
                                />
                            )}
                            {data && (
                                <AnalyticsCard
                                    className="p-4"
                                    style={{ borderColor: divider }}
                                >
                                    <View className="gap-3">
                                        <Text className="text-lg font-bold">
                                            {grain === "week"
                                                ? "Weekly"
                                                : "Monthly"}{" "}
                                            activity
                                        </Text>
                                        <Text className="text-xs text-muted-foreground">
                                            {data.since
                                                ? chartDate(
                                                      data.since.slice(0, 10),
                                                  )
                                                : ""}{" "}
                                            →{" "}
                                            {data.until
                                                ? chartDate(
                                                      data.until.slice(0, 10),
                                                  )
                                                : ""}{" "}
                                            (exclusive)
                                        </Text>
                                        <View className="flex-row gap-3">
                                            <Metric
                                                label="Active users"
                                                footer={`this ${grain === "week" ? "week" : "month"}`}
                                                value={formatCount(
                                                    data.active_users ?? 0,
                                                )}
                                            />
                                            <Metric
                                                label="The average user engaged"
                                                value={`${((data.stickiness ?? 0) * (data.days?.length ?? 0)).toFixed(1)} days`}
                                                footer={`this ${grain === "week" ? "week" : "month"}`}
                                            />
                                        </View>
                                    </View>
                                </AnalyticsCard>
                            )}
                            <Text className="text-xs text-muted-foreground">
                                An active user is someone who plays, skips, or
                                moves within a song in Cadenza that day.
                            </Text>
                        </>
                    )}
                    {data && section === "tags" && (
                        <View className="gap-3">
                            <Text>
                                {data.total} tag names · Page {page + 1}
                            </Text>
                            <View className="flex-row gap-2">
                                <Button
                                    label="Previous"
                                    disabled={!page}
                                    onPress={() => setPage(page - 1)}
                                />
                                <Button
                                    label="Next"
                                    disabled={
                                        (page + 1) * 25 >= (data.total ?? 0)
                                    }
                                    onPress={() => setPage(page + 1)}
                                />
                            </View>
                            <TagDirectory
                                rows={data.rows}
                                defaults={defaults}
                                sort={sort}
                                descending={descending}
                                onSort={(column) => {
                                    setSort(column);
                                    setDescending(
                                        sort === column
                                            ? !descending
                                            : column !== "name",
                                    );
                                    setPage(0);
                                }}
                            />
                            <Text className="text-xs text-muted-foreground">
                                Plays are all-time, using current tag
                                assignments.
                            </Text>
                        </View>
                    )}
                </ScrollView>
                <View
                    pointerEvents="box-none"
                    className="absolute bottom-0 left-0 right-0"
                    style={{ paddingBottom: insets.bottom }}
                    onLayout={(event) =>
                        setNavHeight(event.nativeEvent.layout.height)
                    }
                >
                    <AdminNavigation
                        value={section}
                        onChange={(next) => {
                            if (
                                next === "users" &&
                                period.grain !== "week" &&
                                period.grain !== "month"
                            )
                                setGrain("week");
                            if (next === "social" && period.grain === "day")
                                setGrain("week");
                            setSection(next);
                        }}
                    />
                </View>
            </View>
        </ScrubContext.Provider>
    );
}

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import Svg, { Polyline, Line, Circle, Path } from "react-native-svg";
import { AnalyticsCard } from "@/features/analytics/AnalyticsCard";
import { useAnalyticsPeriod } from "@/features/analytics/analytics-period";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/lib/theme";
import { withAlpha } from "@/lib/artwork-color";
import { formatCount, formatDuration } from "@/features/analytics/format";
import type { AdminDay as Day } from "@/lib/routes/admin";
import { ScrubContext, useAdminDivider } from "./admin-ui";
import {
    calendarChartDays,
    averageDailyUsers,
    chartSegments,
    chartDate,
    chartExtrema,
    reportingBoundary,
    summarizeEndings,
    type SongEndings,
    type ChartField,
} from "./admin-utils";
export function Graph({
    title,
    days,
    field,
    onScrub,
}: {
    title: string;
    days?: Day[];
    field: ChartField;
    onScrub?: (day: string | null) => void;
}) {
    const divider = useAdminDivider();
    const lockScroll = useContext(ScrubContext);
    useEffect(
        () => () => {
            lockScroll(false);
            onScrub?.(null);
        },
        [lockScroll, onScrub],
    );
    const { colors } = useAppTheme();
    const [width, setWidth] = useState(280);
    const [selected, setSelected] = useState<number | null>(null);
    const { period } = useAnalyticsPeriod();
    const rows = calendarChartDays(
        days ?? [],
        reportingBoundary(period.since),
        reportingBoundary(period.until),
    );
    const display = (value: number) =>
        field === "listening_ms"
            ? formatDuration(value)
            : field === "active_users"
              ? `${value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} users`
              : formatCount(value);
    const extrema = chartExtrema(rows, field);
    const maximum = Math.max(1, ...rows.map((d) => d[field] ?? 0));
    const index = selected == null ? null : Math.min(selected, rows.length - 1);
    const picked = index == null ? undefined : rows[index];
    const x = (i: number) =>
        12 + (i * (width - 24)) / Math.max(1, rows.length - 1);
    const y = (value: number) => 144 - (value / maximum) * 128;
    const select = (location: number) => {
        const next = Math.max(
            0,
            Math.min(
                rows.length - 1,
                Math.round(
                    ((location - 12) / (width - 24)) *
                        Math.max(1, rows.length - 1),
                ),
            ),
        );
        setSelected(next);
        onScrub?.(rows[next]?.day ?? null);
    };
    return (
        <AnalyticsCard className="p-4" style={{ borderColor: divider }}>
            <View className="gap-3">
                <View className="flex-row items-start justify-between gap-2">
                    <View className="flex-1 gap-1">
                        <Text className="text-lg font-semibold">
                            {field === "active_users"
                                ? picked
                                    ? "Daily active users"
                                    : `Average daily active users this ${period.grain === "month" ? "month" : "week"}`
                                : title}
                        </Text>
                        <Text className="text-3xl font-bold">
                            {picked
                                ? picked[field] === undefined
                                    ? "—"
                                    : display(picked[field])
                                : field === "active_users"
                                  ? averageDailyUsers(rows).toLocaleString(
                                        "en-US",
                                        {
                                            minimumFractionDigits: 1,
                                            maximumFractionDigits: 1,
                                        },
                                    ) + " users"
                                  : display(
                                        rows.reduce(
                                            (sum, d) => sum + (d[field] ?? 0),
                                            0,
                                        ),
                                    )}
                        </Text>
                        <Text className="text-xs text-muted-foreground">
                            {picked
                                ? chartDate(picked.day)
                                : field === "active_users"
                                  ? "Average DAU · Slide across the chart"
                                  : "Period total · Slide across the chart"}
                        </Text>
                    </View>
                    <View className="gap-1">
                        <Text className="text-xs text-muted-foreground">
                            max {display(extrema.max)}
                        </Text>
                        <Text className="text-xs text-muted-foreground">
                            min {display(extrema.min)}
                        </Text>
                    </View>
                </View>
                <View
                    onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
                    accessibilityRole="adjustable"
                    accessibilityLabel={title}
                    accessibilityValue={{
                        text: picked
                            ? `${chartDate(picked.day)}: ${picked[field] === undefined ? "No data yet" : display(picked[field])}`
                            : "Slide to explore daily values",
                    }}
                    accessibilityActions={[
                        { name: "increment" },
                        { name: "decrement" },
                    ]}
                    onAccessibilityAction={(e) => {
                        const next = Math.max(
                            0,
                            Math.min(
                                rows.length - 1,
                                (index ?? 0) +
                                    (e.nativeEvent.actionName === "increment"
                                        ? 1
                                        : -1),
                            ),
                        );
                        setSelected(next);
                        onScrub?.(rows[next]?.day ?? null);
                    }}
                    onStartShouldSetResponderCapture={() => rows.length > 0}
                    onStartShouldSetResponder={() => rows.length > 0}
                    onMoveShouldSetResponder={() => rows.length > 0}
                    onResponderGrant={(e) => {
                        lockScroll(true);
                        select(e.nativeEvent.locationX);
                    }}
                    onResponderRelease={() => {
                        lockScroll(false);
                        setSelected(null);
                        onScrub?.(null);
                    }}
                    onResponderTerminate={() => {
                        lockScroll(false);
                        setSelected(null);
                        onScrub?.(null);
                    }}
                    onResponderTerminationRequest={() => false}
                    onResponderMove={(e) => select(e.nativeEvent.locationX)}
                >
                    <Svg width={width} height={158}>
                        {[0, 0.5, 1].map((f) => (
                            <Line
                                key={f}
                                x1={12}
                                x2={width - 12}
                                y1={y(f * maximum)}
                                y2={y(f * maximum)}
                                stroke={divider}
                                strokeDasharray="3 5"
                            />
                        ))}
                        {chartSegments(rows, field).map((segment, i) =>
                            segment.length === 1 ? (
                                <Circle
                                    key={i}
                                    cx={x(segment[0].index)}
                                    cy={y(segment[0].value)}
                                    r={3}
                                    fill={colors.brand}
                                />
                            ) : (
                                <Polyline
                                    key={i}
                                    points={segment
                                        .map(
                                            (p) =>
                                                `${x(p.index)},${y(p.value)}`,
                                        )
                                        .join(" ")}
                                    fill="none"
                                    stroke={colors.brand}
                                    strokeWidth={2.5}
                                    strokeLinejoin="round"
                                />
                            ),
                        )}
                        {picked &&
                            picked[field] !== undefined &&
                            index != null && (
                                <>
                                    <Line
                                        x1={x(index)}
                                        x2={x(index)}
                                        y1={8}
                                        y2={150}
                                        stroke={colors.mutedForeground}
                                    />
                                    <Circle
                                        cx={x(index)}
                                        cy={y(picked[field]!)}
                                        r={5}
                                        fill={colors.brand}
                                        stroke={colors.background}
                                        strokeWidth={2}
                                    />
                                </>
                            )}
                    </Svg>
                </View>
                <View className="flex-row justify-between">
                    <Text className="text-xs text-muted-foreground">
                        {rows[0] ? chartDate(rows[0].day) : ""}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                        {rows.at(-1) ? chartDate(rows.at(-1)!.day) : ""}
                    </Text>
                </View>
            </View>
        </AnalyticsCard>
    );
}
export function ListeningGraphs({
    days,
    onScrub,
}: {
    days?: Day[];
    onScrub: (day: string | null) => void;
}) {
    const outerLock = useContext(ScrubContext);
    const initial = useWindowDimensions().width - 40;
    const [width, setWidth] = useState(initial);
    const [page, setPage] = useState(0);
    const [locked, setLocked] = useState(false);
    const pager = useRef<ScrollView>(null);
    const lock = useCallback(
        (active: boolean) => {
            pager.current?.setNativeProps({ scrollEnabled: !active });
            setLocked(active);
            outerLock(active);
        },
        [outerLock],
    );
    return (
        <ScrubContext.Provider value={lock}>
            <View
                className="gap-3"
                onLayout={(e) => {
                    const next = e.nativeEvent.layout.width;
                    if (Math.abs(next - width) > 1) {
                        setWidth(next);
                        pager.current?.scrollTo({
                            x: next * page,
                            animated: false,
                        });
                    }
                }}
            >
                <ScrollView
                    ref={pager}
                    horizontal
                    pagingEnabled
                    scrollEnabled={!locked}
                    showsHorizontalScrollIndicator={false}
                    onScrollBeginDrag={() => onScrub(null)}
                    onMomentumScrollEnd={(e) =>
                        setPage(
                            Math.round(e.nativeEvent.contentOffset.x / width),
                        )
                    }
                >
                    {(["plays", "listening_ms"] as const).map(
                        (field, index) => (
                            <View
                                key={field}
                                style={{ width }}
                                accessibilityElementsHidden={page !== index}
                                importantForAccessibility={
                                    page === index
                                        ? "auto"
                                        : "no-hide-descendants"
                                }
                            >
                                <Graph
                                    title={
                                        index === 0 ? "Song plays" : "Playtime"
                                    }
                                    days={days}
                                    field={field}
                                    onScrub={onScrub}
                                />
                            </View>
                        ),
                    )}
                </ScrollView>
                <View className="flex-row items-center justify-center gap-1">
                    {["Song plays", "Playtime"].map((label, i) => (
                        <Pressable
                            key={label}
                            accessibilityRole="button"
                            accessibilityLabel={`Show ${label}`}
                            accessibilityState={{ selected: page === i }}
                            className="h-8 w-8 items-center justify-center"
                            onPress={() => {
                                setPage(i);
                                onScrub(null);
                                pager.current?.scrollTo({
                                    x: i * width,
                                    animated: true,
                                });
                            }}
                        >
                            <View
                                className={`h-2 w-2 rounded-full ${page === i ? "bg-foreground" : "bg-neutral-300 dark:bg-neutral-700"}`}
                            />
                        </Pressable>
                    ))}
                </View>
            </View>
        </ScrubContext.Provider>
    );
}
export function SongEndingsChart({
    rows,
    day,
}: {
    rows: readonly SongEndings[];
    day: string | null;
}) {
    const { colors } = useAppTheme();
    const divider = useAdminDivider();
    const { period } = useAnalyticsPeriod();
    const values = summarizeEndings(rows, day);
    const total = values.completed + values.early_skips + values.skips;
    const slices = [
        {
            label: "Early skip",
            value: values.early_skips,
            color: colors.destructive,
        },
        {
            label: "Skipped",
            value: values.skips,
            color: withAlpha(colors.brand, 0.5),
        },
        { label: "Completed", value: values.completed, color: colors.success },
    ];
    let angle = -Math.PI / 2;
    return (
        <AnalyticsCard className="p-4" style={{ borderColor: divider }}>
            <View className="gap-3">
                <Text className="text-xl font-semibold">
                    Song endings {day ? "this day" : `this ${period.grain}`}
                </Text>
                <Text className="text-xs text-muted-foreground">
                    {day ? chartDate(day) : "Selected period"} ·{" "}
                    {total.toLocaleString()} observed endings
                </Text>
                <View className="flex-row flex-wrap items-center gap-5">
                    <View
                        accessible
                        accessibilityLabel={slices
                            .map(
                                (s) =>
                                    `${s.label}: ${s.value}, ${total ? ((100 * s.value) / total).toFixed(1) : 0} percent`,
                            )
                            .join(". ")}
                    >
                        <Svg width={128} height={128}>
                            {!total && (
                                <Circle
                                    cx={64}
                                    cy={64}
                                    r={60}
                                    fill={colors.muted}
                                />
                            )}
                            {slices.map((slice) => {
                                const start = angle;
                                angle += total
                                    ? (slice.value / total) * Math.PI * 2
                                    : 0;
                                if (!slice.value) return null;
                                if (slice.value === total)
                                    return (
                                        <Circle
                                            key={slice.label}
                                            cx={64}
                                            cy={64}
                                            r={60}
                                            fill={slice.color}
                                        />
                                    );
                                return (
                                    <Path
                                        key={slice.label}
                                        fill={slice.color}
                                        d={`M64,64 L${64 + 60 * Math.cos(start)},${64 + 60 * Math.sin(start)} A60,60 0 ${angle - start > Math.PI ? 1 : 0},1 ${64 + 60 * Math.cos(angle)},${64 + 60 * Math.sin(angle)} Z`}
                                    />
                                );
                            })}
                        </Svg>
                    </View>
                    <View className="min-w-36 flex-1 gap-3">
                        {slices.map((s) => (
                            <View
                                key={s.label}
                                className="flex-row items-center gap-2"
                            >
                                <View
                                    className="h-2.5 w-2.5 rounded-full"
                                    style={{ backgroundColor: s.color }}
                                />
                                <View className="flex-1">
                                    <Text className="text-sm">{s.label}</Text>
                                    <Text className="text-xs text-muted-foreground">
                                        {s.value.toLocaleString()} ·{" "}
                                        {total
                                            ? ((s.value / total) * 100).toFixed(
                                                  1,
                                              )
                                            : "0"}
                                        %
                                    </Text>
                                </View>
                            </View>
                        ))}
                    </View>
                </View>
                {!total && (
                    <Text className="text-sm text-muted-foreground">
                        No observed song endings.
                    </Text>
                )}
            </View>
        </AnalyticsCard>
    );
}

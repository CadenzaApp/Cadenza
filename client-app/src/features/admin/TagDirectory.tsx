import { AnalyticsCard } from "@/features/analytics/AnalyticsCard";
import { useAdminDivider, ADMIN_BLACK_OVERLAY } from "./admin-ui";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { Text } from "@/components/ui/text";
import { formatCount } from "@/features/analytics/format";

type Column = "name" | "songs" | "plays" | "accounts";
type Row = { name?: string; songs?: number; plays?: number; accounts?: number };
const LABELS = {
    name: "Tag",
    songs: "Songs",
    plays: "Plays",
    accounts: "Accounts",
};
export function TagDirectory({
    rows,
    defaults,
    sort,
    descending,
    onSort,
}: {
    rows?: Row[];
    defaults: boolean;
    sort: string;
    descending: boolean;
    onSort: (column: string) => void;
}) {
    const { width } = useWindowDimensions();
    const divider = useAdminDivider();
    const numericWidth = (column: Column) =>
        defaults
            ? column === "songs"
                ? 132
                : 88
            : column === "accounts"
              ? 88
              : column === "songs"
                ? 72
                : 64;
    const columns: Column[] = defaults
        ? ["name", "songs", "plays"]
        : ["name", "songs", "plays", "accounts"];
    const size = (column: Column) =>
        column === "name"
            ? Math.max(
                  88,
                  width -
                      40 -
                      24 -
                      columns
                          .filter((c) => c !== "name")
                          .reduce((sum, c) => sum + numericWidth(c), 0),
              )
            : numericWidth(column);
    const total = columns.reduce((sum, c) => sum + size(c), 24);
    return (
        <AnalyticsCard className="p-0" style={{ borderColor: divider }}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator
                nestedScrollEnabled
                accessibilityLabel="Tag statistics table"
            >
                <View style={{ width: total }}>
                    <View
                        style={{ backgroundColor: ADMIN_BLACK_OVERLAY }}
                        className="flex-row px-3"
                    >
                        {columns.map((column) => (
                            <View
                                key={column}
                                style={{ width: size(column) }}
                                className="relative"
                            >
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Sort by ${LABELS[column]}${sort === column ? (descending ? ", descending" : ", ascending") : ""}`}
                                    onPress={() => onSort(column)}
                                    className="min-h-12 justify-center px-2 active:opacity-60"
                                >
                                    <Text
                                        className={`text-xs font-semibold ${column === "name" ? "" : "text-right"}`}
                                    >
                                        {LABELS[column]}
                                        {sort === column
                                            ? descending
                                                ? " ↓"
                                                : " ↑"
                                            : ""}
                                    </Text>
                                </Pressable>
                            </View>
                        ))}
                    </View>
                    {rows?.map((row) => (
                        <View
                            key={row.name}
                            style={{ borderTopColor: divider }}
                            className="flex-row items-center border-t px-3 py-3.5"
                        >
                            {columns.map((column) => (
                                <Text
                                    key={column}
                                    style={{ width: size(column) }}
                                    className={`px-2 text-sm ${column === "name" ? "" : "text-right"}`}
                                >
                                    {column === "name"
                                        ? row.name
                                        : formatCount(row[column] ?? 0)}
                                </Text>
                            ))}
                        </View>
                    ))}
                    {!rows?.length && (
                        <Text className="p-5 text-sm text-muted-foreground">
                            No matching tags.
                        </Text>
                    )}
                </View>
            </ScrollView>
        </AnalyticsCard>
    );
}

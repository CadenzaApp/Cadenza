import { View } from "react-native";

import { Text } from "@/components/ui/text";

import { useAnalyticsPeriod } from "./analytics-period";
import { GrainPicker, PeriodStepper } from "./PeriodControls";

type Props = {
    /** The page tint, for the heading. Falls back to the muted text color. */
    accent: string | null;
    /** "just now", "5m ago", or null before the first read lands. */
    updatedAgo: string | null;
    /** The last read failed, so the page is showing what it had before. */
    offline: boolean;
};

/**
 * The top of the overview: which period this is, the dates it covers, and the
 * controls that move it. Scrolls with the page rather than pinning, so nothing
 * floating over the top of the screen can cover a fixed filter row.
 */
export function AnalyticsHeader({ accent, updatedAgo, offline }: Props) {
    const { period } = useAnalyticsPeriod();

    return (
        <View className="gap-3">
            <View className="gap-1">
                <Text
                    className="text-3xl font-bold tracking-tight"
                    style={accent ? { color: accent } : null}
                >
                    Listening {period.phrase}
                </Text>
                <Text className="text-muted-foreground text-xl font-semibold">
                    {period.dateLabel}
                </Text>
            </View>

            <View className="flex-row items-center justify-between gap-3">
                <GrainPicker />
                <PeriodStepper />
            </View>

            {offline ? (
                <View className="flex-row items-center gap-2">
                    <View className="h-2 w-2 rounded-full bg-amber-500" />
                    <Text className="text-muted-foreground text-xs">
                        Offline
                        {updatedAgo
                            ? `, updated ${updatedAgo}`
                            : ", showing saved"}
                    </Text>
                </View>
            ) : updatedAgo ? (
                <View className="flex-row items-center gap-2">
                    <View className="h-2 w-2 rounded-full bg-green-500" />
                    <Text className="text-muted-foreground text-xs">
                        Updated {updatedAgo}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

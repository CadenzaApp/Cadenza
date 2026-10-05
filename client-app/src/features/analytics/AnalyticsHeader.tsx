import { View } from "react-native";

import { Text } from "@/components/ui/text";

import { useAnalyticsPeriod } from "./analytics-period";
import { GrainPicker, PeriodStepper } from "./PeriodControls";

type Props = {
    /** The page tint, for the eyebrow. Falls back to the muted text color. */
    accent: string | null;
    /** "just now", "5m ago", or null before the first read lands. */
    updatedAgo: string | null;
};

/**
 * The top of the overview: which period this is, the dates it covers, and the
 * controls that move it. Scrolls with the page rather than pinning, so nothing
 * floating over the top of the screen can cover a fixed filter row.
 */
export function AnalyticsHeader({ accent, updatedAgo }: Props) {
    const { period } = useAnalyticsPeriod();

    return (
        <View className="gap-3">
            <View className="gap-1">
                <Text
                    className="text-muted-foreground text-xs font-semibold uppercase tracking-[3px]"
                    style={accent ? { color: accent } : null}
                >
                    Listening {period.phrase}
                </Text>
                <Text className="text-4xl font-bold tracking-tight">
                    {period.title}
                </Text>
            </View>

            <View className="flex-row items-center justify-between gap-3">
                <View className="flex-1 flex-row flex-wrap items-center gap-x-3 gap-y-2">
                    <Text className="text-muted-foreground text-base">
                        {period.dateLabel}
                    </Text>
                    <GrainPicker />
                </View>
                <PeriodStepper />
            </View>

            {updatedAgo ? (
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

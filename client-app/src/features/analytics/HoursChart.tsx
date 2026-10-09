import { View } from "react-native";

import { Text } from "@/components/ui/text";

import { AnalyticsCard } from "./AnalyticsCard";
import { BarChart, type Bar } from "./BarChart";
import { formatCount, formatHour } from "./format";

/**
 * Plays across the hours of the local day, which says far more about a single
 * day than a one-bar trend would. What the Today range shows instead of a trend,
 * off `plays_by_hour` in the summary, so it costs no extra request.
 */
export function HoursChart({
    playsByHour,
    color,
}: {
    playsByHour: number[];
    color?: string | null;
}) {
    const bars: Bar[] = playsByHour.map((plays, hour) => ({
        label: formatHour(hour),
        value: plays,
        readout: `${formatHour(hour)}: ${formatCount(plays)} plays`,
    }));

    return (
        <AnalyticsCard>
            <View className="gap-1">
                <Text role="heading" className="text-lg font-semibold">
                    By hour
                </Text>
            </View>
            <BarChart
                bars={bars}
                unit="count"
                totalLabel="Total plays"
                height={110}
                color={color}
            />
        </AnalyticsCard>
    );
}

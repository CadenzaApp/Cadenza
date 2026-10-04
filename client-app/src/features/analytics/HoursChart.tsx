import { View } from "react-native";

import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Text } from "@/components/ui/text";

import { BarChart, type Bar } from "./BarChart";
import { formatCount, formatHour } from "./format";

/**
 * Plays across the hours of the local day, which says far more about a single
 * day than a one-bar trend would. What the Today range shows instead of a trend,
 * off `plays_by_hour` in the summary, so it costs no extra request.
 */
export function HoursChart({ playsByHour }: { playsByHour: number[] }) {
    const bars: Bar[] = playsByHour.map((plays, hour) => ({
        label: formatHour(hour),
        value: plays,
        readout: `${formatHour(hour)}: ${formatCount(plays)} plays`,
    }));

    return (
        <Card>
            <CardContent className="gap-4">
                <View className="gap-1">
                    <CardTitle>By hour</CardTitle>
                    <Text className="text-muted-foreground text-xs">
                        Tap a bar for its value.
                    </Text>
                </View>
                <BarChart bars={bars} maxLabels={5} height={110} />
            </CardContent>
        </Card>
    );
}

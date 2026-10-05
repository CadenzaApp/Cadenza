import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { Fragment, type ComponentProps } from "react";
import { View } from "react-native";

import { Text } from "@/components/ui/text";

import { AnalyticsCard } from "./AnalyticsCard";

export type Stat = {
    icon: ComponentProps<typeof Ionicons>["name"];
    value: string;
    label: string;
};

/**
 * A few headline numbers side by side on one glass card, each with an icon.
 * Takes its stats as data, so what the overview shows is decided there.
 */
export function StatsStrip({
    stats,
    accent,
}: {
    stats: readonly Stat[];
    accent: string | null;
}) {
    const { colors } = useTheme();

    return (
        <AnalyticsCard className="flex-row gap-0 px-2 py-4">
            {stats.map((stat, index) => (
                <Fragment key={stat.label}>
                    {index > 0 ? (
                        <View className="my-2 w-px bg-border" />
                    ) : null}
                    <View
                        className="flex-1 items-center gap-1"
                        accessible
                        accessibilityLabel={`${stat.value} ${stat.label}`}
                    >
                        <Ionicons
                            name={stat.icon}
                            size={20}
                            color={accent ?? colors.text}
                        />
                        <Text
                            className="text-2xl font-bold"
                            numberOfLines={1}
                            adjustsFontSizeToFit
                        >
                            {stat.value}
                        </Text>
                        <Text className="text-muted-foreground text-xs">
                            {stat.label}
                        </Text>
                    </View>
                </Fragment>
            ))}
        </AnalyticsCard>
    );
}

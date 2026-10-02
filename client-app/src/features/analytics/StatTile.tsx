import { View } from "react-native";

import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

type Props = {
    label: string;
    value: string;
    /** One short line under the number, when the number needs context. */
    hint?: string;
    className?: string;
};

/**
 * One number with its name. A count is a headline, not a chart, so it gets a tile
 * rather than a one-bar plot.
 */
export function StatTile({ label, value, hint, className }: Props) {
    return (
        <View
            className={cn(
                "bg-card border-border flex-1 gap-1 rounded-xl border p-4",
                className,
            )}
        >
            <Text className="text-muted-foreground text-xs">{label}</Text>
            <Text className="text-2xl font-semibold">{value}</Text>
            {hint ? (
                <Text className="text-muted-foreground text-xs">{hint}</Text>
            ) : null}
        </View>
    );
}

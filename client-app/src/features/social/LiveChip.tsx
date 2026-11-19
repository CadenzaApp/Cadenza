import { View } from "react-native";

import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/** The "LIVE" pill on anything in a live session. `ended` mutes it. */
export function LiveChip({
    ended = false,
    className,
}: {
    ended?: boolean;
    className?: string;
}) {
    return (
        <View
            accessibilityRole="text"
            accessibilityLabel={ended ? "Session ended" : "Live session"}
            className={cn(
                "self-start rounded-full px-2 py-0.5",
                ended ? "bg-muted" : "bg-brand",
                className,
            )}
        >
            <Text
                className={cn(
                    "text-[10px] font-bold tracking-wider",
                    ended ? "text-muted-foreground" : "text-brand-foreground",
                )}
            >
                {ended ? "ENDED" : "LIVE"}
            </Text>
        </View>
    );
}

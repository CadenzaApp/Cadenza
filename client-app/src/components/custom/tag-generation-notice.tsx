import Ionicons from "@expo/vector-icons/Ionicons";
import { useColorScheme } from "nativewind";
import { View } from "react-native";

import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

// amber-600 and amber-400, to match the amber classes below.
const ICON_COLOR = { light: "#d97706", dark: "#fbbf24" };
const ICON_SIZE = 18;

type TagGenerationNoticeProps = {
    className?: string;
};

/**
 * Warns that some songs are still being tagged, so a query may miss them.
 * Static for now: always rendered, not tied to real generation state.
 */
export function TagGenerationNotice({ className }: TagGenerationNoticeProps) {
    const { colorScheme } = useColorScheme();

    return (
        <View
            accessible
            className={cn(
                "flex-row items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5",
                className,
            )}
        >
            <Ionicons
                name="warning-outline"
                size={ICON_SIZE}
                color={ICON_COLOR[colorScheme === "dark" ? "dark" : "light"]}
                style={{ marginTop: 1 }}
            />
            <View className="flex-1 gap-0.5">
                <Text className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    Tags are still being generated
                </Text>
                <Text className="text-sm text-amber-800 dark:text-amber-300">
                    Some of your songs are not tagged yet, so queries may not
                    reach all of them.
                </Text>
            </View>
        </View>
    );
}

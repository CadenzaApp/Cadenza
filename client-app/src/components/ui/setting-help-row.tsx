import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/lib/theme";

/** A settings label and toggle slot with an optional information popover. */
export function SettingHelpRow({
    label,
    help,
    helpOpen,
    helpPlacement = "below",
    onHelpPress,
    reserveHelpSpace = false,
    children,
}: {
    label: string;
    help: string;
    helpOpen: boolean;
    helpPlacement?: "above" | "below";
    onHelpPress: () => void;
    /** Keep an enclosing modal tall enough for the popover. */
    reserveHelpSpace?: boolean;
    children: ReactNode;
}) {
    const { colors } = useAppTheme();
    const [helpHeight, setHelpHeight] = useState(0);
    return (
        <View className="py-2" style={{ zIndex: helpOpen ? 10 : 0 }}>
            <View className="min-h-11 flex-row items-center gap-3">
                {/* the label wraps instead of pushing its toggle out of line */}
                <View className="flex-1 flex-row items-center gap-1">
                    <Text className="shrink text-sm font-semibold">
                        {label}
                    </Text>
                    <Pressable
                        onPress={onHelpPress}
                        accessibilityRole="button"
                        accessibilityLabel={`About ${label}`}
                        accessibilityState={{ expanded: helpOpen }}
                        className="h-8 w-8 shrink-0 items-center justify-center"
                        hitSlop={4}
                    >
                        <Ionicons
                            name="information-circle-outline"
                            size={18}
                            color={colors.mutedForeground}
                        />
                    </Pressable>
                </View>
                <View className="shrink-0 items-end">{children}</View>
            </View>
            {helpOpen ? (
                <View
                    onLayout={
                        reserveHelpSpace
                            ? (event) =>
                                  setHelpHeight(event.nativeEvent.layout.height)
                            : undefined
                    }
                    className="absolute left-5 right-2 rounded-xl border border-border bg-popover px-3 py-2 shadow-lg"
                    style={{
                        [helpPlacement === "above" ? "bottom" : "top"]: 48,
                        elevation: 20,
                    }}
                >
                    <Text className="text-sm text-muted-foreground">
                        {help}
                    </Text>
                </View>
            ) : null}
            {helpOpen && reserveHelpSpace ? (
                <View style={{ height: helpHeight }} />
            ) : null}
        </View>
    );
}

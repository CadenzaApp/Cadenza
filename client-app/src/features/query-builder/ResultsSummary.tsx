import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { ActivityIndicator, View } from "react-native";
import { GlassButton } from "@/components/ui/glass-button";
import { Text } from "@/components/ui/text";

/** Query evaluation is independent of loading artwork and playable tracks. */
export function ResultsSummary({
    count,
    loading,
    error,
    hasQuery,
    isLibraryConnected,
    onNext,
    onRetry,
    invalidMessage,
}: {
    count: number;
    loading: boolean;
    error?: unknown;
    hasQuery: boolean;
    isLibraryConnected: boolean;
    onNext: () => void;
    onRetry: () => void;
    invalidMessage?: string | null;
}) {
    const { colors } = useTheme();
    const label = !hasQuery
        ? invalidMessage
            ? "Finish query"
            : "Results"
        : loading
          ? "Finding results..."
          : error
            ? "Retry results"
            : `${count} ${count === 1 ? "result" : "results"}`;
    const disabled =
        !isLibraryConnected || !hasQuery || loading || (!error && count === 0);
    return (
        <View className="max-w-72 items-end gap-2">
            <GlassButton
                className="h-9 rounded-full px-4"
                onPress={error ? onRetry : onNext}
                disabled={disabled}
                accessibilityLabel={error ? "Retry loading results" : label}
                accessibilityState={{ disabled }}
            >
                <Text className="flex-shrink text-sm font-semibold">
                    {label}
                </Text>
                {loading ? (
                    <ActivityIndicator color={colors.text} />
                ) : (
                    <Ionicons
                        name={error ? "refresh" : "arrow-forward"}
                        size={19}
                        color={colors.text}
                    />
                )}
            </GlassButton>
            {!isLibraryConnected ? (
                <Text className="text-sm text-muted-foreground">
                    Connect Apple Music in Account to find songs in your
                    library.
                </Text>
            ) : error ? (
                <Text
                    accessibilityLiveRegion="polite"
                    className="text-sm text-destructive"
                >
                    Could not load results. Your query is safe. Tap Retry
                    results.
                </Text>
            ) : null}
        </View>
    );
}

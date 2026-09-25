import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useEffect } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { classifyError, type AppErrorKind } from "@/lib/app-error";
import { cn } from "@/lib/utils";

type IoniconName = keyof typeof Ionicons.glyphMap;

const ICONS: Record<AppErrorKind, IoniconName> = {
    "apple-music-auth": "musical-notes-outline",
    "apple-music-unavailable": "musical-notes-outline",
    "apple-music-api": "cloud-offline-outline",
    "session-expired": "person-circle-outline",
    "not-found": "help-circle-outline",
    offline: "wifi-outline",
    unknown: "alert-circle-outline",
};

type Props = {
    /** The thrown value. Classified here, so callers pass it straight through. */
    error: unknown;
    /** Called when the person asks to try again. Omit to hide the retry button. */
    onRetry?: () => void;
    className?: string;
};

/**
 * The one place an error becomes something a person reads.
 *
 * Screens render this instead of the error's own message. A native MusicKit
 * rejection stringifies to a Swift stack trace and a backend rejection is a
 * bare `{ error_type }`, so neither is fit to show. `classifyError` turns both
 * into a heading, a sentence, and whatever way out exists.
 */
export function ErrorNotice({ error, onRetry, className }: Props) {
    const appError = classifyError(error);
    const router = useRouter();
    const { colors } = useTheme();

    // the raw cause still belongs in the log, just not on screen
    useEffect(() => {
        console.error(`[${appError.kind}]`, appError.cause);
    }, [appError.kind, appError.cause]);

    return (
        <View
            className={cn("items-center gap-2 px-6 py-8", className)}
            accessibilityRole="alert"
        >
            <Ionicons
                name={ICONS[appError.kind]}
                size={28}
                color={colors.text}
            />
            <Text className="text-center text-base font-semibold">
                {appError.title}
            </Text>
            <Text className="text-center text-sm text-muted-foreground">
                {appError.detail}
            </Text>

            {appError.action || (onRetry && appError.retryable) ? (
                <View className="mt-2 flex-row gap-2">
                    {onRetry && appError.retryable ? (
                        <Button variant="secondary" size="sm" onPress={onRetry}>
                            <Text>Try again</Text>
                        </Button>
                    ) : null}
                    {appError.action ? (
                        <Button
                            size="sm"
                            onPress={() => router.push(appError.action!.href as never)}
                        >
                            <Text>{appError.action.label}</Text>
                        </Button>
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}

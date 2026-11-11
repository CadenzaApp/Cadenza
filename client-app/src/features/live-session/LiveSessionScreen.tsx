import { useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

import { ErrorNotice } from "@/components/custom/error-notice";
import { DetailScreen } from "@/components/ui/detail-screen";
import { GlassButton } from "@/components/ui/glass-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { isSessionGone, useLiveSession } from "@/lib/routes/live-sessions";

import { errorType } from "./session-parts";

/**
 * `/live-session/:id`. A session lives in the now playing sheet, so an open
 * one the caller is in hands straight over to `/player`. What is left here is
 * for links to one that is over, or not the caller's, like the Analytics
 * rankings: it says so.
 */
export function LiveSessionScreen({ sessionId }: { sessionId: string }) {
    const router = useRouter();
    const {
        liveSession,
        liveSessionLoading,
        liveSessionErr,
        reloadLiveSession,
    } = useLiveSession(sessionId);

    const open = Boolean(liveSession);
    useEffect(() => {
        if (open) router.replace("/player");
    }, [open, router]);

    if (liveSessionErr && !liveSession) {
        const type = errorType(liveSessionErr);
        const gone = isSessionGone(liveSessionErr);
        return (
            <DetailScreen presentation="sheet" title="Live session">
                <View className="flex-1 items-center justify-center gap-4 px-6">
                    {gone ? (
                        <>
                            <Text className="text-center text-base font-semibold text-foreground">
                                {type === "SessionEnded"
                                    ? "This session has ended."
                                    : "You're not in this session."}
                            </Text>
                            <GlassButton onPress={() => router.back()}>
                                <Text className="font-semibold text-foreground">
                                    Close
                                </Text>
                            </GlassButton>
                        </>
                    ) : (
                        <ErrorNotice
                            error={liveSessionErr}
                            onRetry={() => void reloadLiveSession()}
                        />
                    )}
                </View>
            </DetailScreen>
        );
    }

    if (!liveSession) {
        return (
            <DetailScreen presentation="sheet" title="Live session">
                <View className="items-center gap-4 px-5 pt-6">
                    <Skeleton className="h-56 w-56 rounded-3xl" />
                    <Skeleton className="h-5 w-40 rounded" />
                    {liveSessionLoading ? null : (
                        <Text className="text-sm text-muted-foreground">
                            Loading...
                        </Text>
                    )}
                </View>
            </DetailScreen>
        );
    }

    return null;
}

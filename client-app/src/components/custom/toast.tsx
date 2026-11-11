import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { useTopRailInset } from "@/lib/top-rail";
import { cn } from "@/lib/utils";

export type ToastMessage = { message: string; error: boolean };

const TOAST_MS = 3000;

/** The current toast and `showToast`, which replaces it and clears it after 3 seconds. */
export function useToast() {
    const [toast, setToast] = useState<ToastMessage | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const showToast = useCallback((message: string, error = false) => {
        if (timer.current) clearTimeout(timer.current);
        setToast({ message, error });
        timer.current = setTimeout(() => setToast(null), TOAST_MS);
    }, []);
    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current);
        },
        [],
    );
    return { toast, showToast };
}

/**
 * A glass banner over the top of its screen, under the top rail when there is
 * one and under the safe area otherwise. Render it last in the screen.
 */
export function Toast({ toast }: { toast: ToastMessage | null }) {
    const railInset = useTopRailInset();
    const insets = useSafeAreaInsets();
    if (!toast) return null;
    return (
        <View
            pointerEvents="none"
            accessibilityRole="alert"
            style={{ top: railInset ?? insets.top + 8 }}
            className={cn(
                "absolute left-5 right-5 overflow-hidden rounded-2xl border px-4 py-3",
                toast.error ? "border-destructive" : "border-border",
            )}
        >
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <GlassSurface
                    variant="regular"
                    style={StyleSheet.absoluteFill}
                />
            </View>
            <Text
                className={cn(
                    "text-center text-sm font-semibold",
                    toast.error ? "text-destructive" : "text-foreground",
                )}
            >
                {toast.message}
            </Text>
        </View>
    );
}

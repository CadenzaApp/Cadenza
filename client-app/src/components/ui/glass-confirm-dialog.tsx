import * as AlertDialogPrimitive from "@rn-primitives/alert-dialog";
import { useTheme } from "expo-router/react-navigation";
import { Fragment } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { FullWindowOverlay as RNFullWindowOverlay } from "react-native-screens";

import { GlassButton } from "@/components/ui/glass-button";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";

const FullWindowOverlay =
    Platform.OS === "ios" ? RNFullWindowOverlay : Fragment;

type GlassConfirmDialogProps = {
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    pendingLabel: string;
    pending?: boolean;
    error?: string | null;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
};

/** Accessible destructive confirmation rendered on the shared glass surface. */
export function GlassConfirmDialog({
    open,
    title,
    description,
    confirmLabel,
    pendingLabel,
    pending = false,
    error,
    onOpenChange,
    onConfirm,
}: GlassConfirmDialogProps) {
    const { colors } = useTheme();

    return (
        <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            <AlertDialogPrimitive.Portal>
                <FullWindowOverlay>
                    <AlertDialogPrimitive.Overlay
                        className="absolute inset-0 items-center justify-center bg-black/50 px-5"
                        asChild={Platform.OS !== "web"}
                    >
                        <View className="w-full items-center">
                            <AlertDialogPrimitive.Content className="w-full max-w-lg overflow-hidden rounded-3xl border border-border px-5 py-5">
                                <View
                                    pointerEvents="none"
                                    style={StyleSheet.absoluteFill}
                                >
                                    <GlassSurface
                                        variant="regular"
                                        style={StyleSheet.absoluteFill}
                                    />
                                </View>

                                <AlertDialogPrimitive.Title asChild>
                                    <Text className="text-xl font-semibold">
                                        {title}
                                    </Text>
                                </AlertDialogPrimitive.Title>
                                <AlertDialogPrimitive.Description asChild>
                                    <Text className="mt-2 leading-6 text-muted-foreground">
                                        {description}
                                    </Text>
                                </AlertDialogPrimitive.Description>

                                {error ? (
                                    <Text className="mt-3 text-sm text-destructive">
                                        {error}
                                    </Text>
                                ) : null}

                                <View className="mt-5 gap-3">
                                    <GlassButton
                                        variant="destructive"
                                        disabled={pending}
                                        onPress={onConfirm}
                                        className="w-full"
                                    >
                                        {pending ? (
                                            <ActivityIndicator
                                                size="small"
                                                color={colors.notification}
                                            />
                                        ) : null}
                                        <Text>
                                            {pending
                                                ? pendingLabel
                                                : confirmLabel}
                                        </Text>
                                    </GlassButton>
                                    <AlertDialogPrimitive.Cancel asChild>
                                        <GlassButton
                                            disabled={pending}
                                            className="w-full"
                                        >
                                            <Text>Cancel</Text>
                                        </GlassButton>
                                    </AlertDialogPrimitive.Cancel>
                                </View>
                            </AlertDialogPrimitive.Content>
                        </View>
                    </AlertDialogPrimitive.Overlay>
                </FullWindowOverlay>
            </AlertDialogPrimitive.Portal>
        </AlertDialogPrimitive.Root>
    );
}

import type { ReactNode } from "react";
import {
    Modal,
    Pressable,
    StyleSheet,
    View,
    type StyleProp,
    type ViewStyle,
} from "react-native";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

type ModalPopupProps = {
    visible: boolean;
    onClose: () => void;
    title?: string;
    children: ReactNode;
    contentStyle?: StyleProp<ViewStyle>;
    /** Liquid glass by default; "solid" is the explicit compatibility escape hatch. */
    variant?: "solid" | "glass";
};

/** Shared modal popup with the app's standard fade and outside-tap dismissal. */
export function ModalPopup({
    visible,
    onClose,
    title,
    children,
    contentStyle,
    variant = "glass",
}: ModalPopupProps) {
    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <Pressable
                className="flex-1 items-center justify-center bg-black/70 px-4 py-8"
                onPress={onClose}
            >
                <Pressable
                    accessibilityViewIsModal
                    className={cn(
                        "w-[70%] max-w-[400px] min-w-[240px] gap-2 overflow-hidden rounded-2xl p-4",
                        variant === "solid" &&
                            "border border-border bg-popover shadow-lg shadow-black/5",
                    )}
                    style={contentStyle}
                    onPress={(event) => event.stopPropagation()}
                >
                    {variant === "glass" ? (
                        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                            <GlassSurface
                                variant="regular"
                                style={StyleSheet.absoluteFill}
                            />
                        </View>
                    ) : null}
                    {title ? (
                        <Text className="text-lg font-semibold text-popover-foreground">
                            {title}
                        </Text>
                    ) : null}
                    {children}
                </Pressable>
            </Pressable>
        </Modal>
    );
}

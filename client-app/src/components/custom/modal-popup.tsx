import type { ReactNode } from "react";
import {
    KeyboardAvoidingView,
    Modal,
    Platform,
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
    keyboardAware?: boolean;
    visible: boolean;
    onClose: () => void;
    title?: string;
    titleClassName?: string;
    children: ReactNode;
    contentStyle?: StyleProp<ViewStyle>;
    /** Overrides the default backdrop padding around the popup. */
    backdropClassName?: string;
    /** Liquid glass by default; solid and transparent are explicit shells. */
    variant?: "solid" | "glass" | "transparent";
    /**
     * Fills the modal instead of centering a card. A percentage height inside
     * the card resolves to 0 on Android, which leaves only the black backdrop.
     */
    fullscreen?: boolean;
};

/** Shared modal popup with the app's standard fade and outside-tap dismissal. */
export function ModalPopup({
    visible,
    keyboardAware = false,
    onClose,
    title,
    titleClassName,
    children,
    contentStyle,
    backdropClassName,
    variant = "glass",
    fullscreen = false,
}: ModalPopupProps) {
    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
            statusBarTranslucent={fullscreen}
            navigationBarTranslucent={fullscreen}
        >
            <KeyboardAvoidingView
                className="flex-1"
                enabled={keyboardAware && !fullscreen}
                behavior={Platform.OS === "ios" ? "padding" : "height"}
            >
                <View
                    className={cn(
                        fullscreen
                            ? "flex-1 bg-black"
                            : "flex-1 items-center justify-center bg-black/70 px-4 py-8",
                        backdropClassName,
                    )}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Dismiss"
                        onPress={onClose}
                        style={StyleSheet.absoluteFill}
                    />
                    <View
                        accessibilityViewIsModal
                        collapsable={false}
                        className={cn(
                            "z-10",
                            fullscreen
                                ? "flex-1 self-stretch"
                                : "w-[70%] max-w-[400px] min-w-[240px] gap-2 overflow-hidden rounded-2xl p-4",
                            !fullscreen &&
                                (variant === "solid"
                                    ? "border border-border bg-popover shadow-lg shadow-black/5"
                                    : "bg-transparent"),
                        )}
                        style={fullscreen ? styles.fullscreen : contentStyle}
                    >
                        {variant === "glass" ? (
                            <View
                                pointerEvents="none"
                                style={StyleSheet.absoluteFill}
                            >
                                <GlassSurface
                                    variant="regular"
                                    style={StyleSheet.absoluteFill}
                                />
                            </View>
                        ) : null}
                        {title ? (
                            <Text
                                className={cn(
                                    "text-lg font-semibold text-popover-foreground",
                                    titleClassName,
                                )}
                            >
                                {title}
                            </Text>
                        ) : null}
                        {children}
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    // Flex, not a percentage height. Android gives a percentage child of the
    // centered card a height of 0.
    fullscreen: { flex: 1, alignSelf: "stretch" },
});

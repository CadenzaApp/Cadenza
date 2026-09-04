import type { ReactNode } from "react";
import {
    Modal,
    Pressable,
    type StyleProp,
    type ViewStyle,
} from "react-native";

import { Text } from "@/components/ui/text";

type ModalPopupProps = {
    visible: boolean;
    onClose: () => void;
    title?: string;
    children: ReactNode;
    contentStyle?: StyleProp<ViewStyle>;
};

/** Shared modal popup with the app's standard fade and outside-tap dismissal. */
export function ModalPopup({
    visible,
    onClose,
    title,
    children,
    contentStyle,
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
                    className="w-[70%] max-w-[400px] min-w-[240px] gap-2 rounded-lg border border-border bg-popover p-4 shadow-lg shadow-black/5"
                    style={contentStyle}
                    onPress={(event) => event.stopPropagation()}
                >
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

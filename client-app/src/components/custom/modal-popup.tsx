import * as DialogPrimitive from "@rn-primitives/dialog";
import type { ReactNode } from "react";
import {
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    View,
    type StyleProp,
    type ViewStyle,
} from "react-native";
import { FadeIn, FadeOut } from "react-native-reanimated";

import { GlassSurface } from "@/components/ui/glass-surface";
import { NativeOnlyAnimatedView } from "@/components/ui/native-only-animated-view";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

type ModalPopupProps = {
    visible: boolean;
    onClose: () => void;
    title?: string;
    children: ReactNode;
    contentStyle?: StyleProp<ViewStyle>;
    /** "glass" renders the card on liquid glass instead of the flat popover surface. */
    variant?: "solid" | "glass";
};

/** The dim behind the card. Pressing it closes the popup. */
const BACKDROP_CLASS =
    "flex-1 items-center justify-center bg-black/70 px-4 py-8";

/** The card's size and shape, the same in a Modal and in the portal. */
const CARD_CLASS =
    "w-[70%] max-w-[400px] min-w-[240px] gap-2 overflow-hidden rounded-2xl p-4";

const TITLE_CLASS = "text-lg font-semibold text-popover-foreground";

/** Shared modal popup with the app's standard fade and outside-tap dismissal. */
export function ModalPopup(props: ModalPopupProps) {
    // an RN Modal is its own Android window, where glass cannot reach the
    // root layout's blur target, so Android glass renders in the app's window
    if (props.variant === "glass" && Platform.OS === "android") {
        return <PortalPopup {...props} />;
    }

    const {
        visible,
        onClose,
        title,
        children,
        contentStyle,
        variant = "solid",
    } = props;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <Pressable className={BACKDROP_CLASS} onPress={onClose}>
                <Pressable
                    accessibilityViewIsModal
                    className={cn(
                        CARD_CLASS,
                        variant === "solid" &&
                            "border border-border bg-popover shadow-lg shadow-black/5",
                    )}
                    style={contentStyle}
                    onPress={(event) => event.stopPropagation()}
                >
                    {variant === "glass" ? <GlassBackground /> : null}
                    {title ? (
                        <Text className={TITLE_CLASS}>{title}</Text>
                    ) : null}
                    {children}
                </Pressable>
            </Pressable>
        </Modal>
    );
}

/**
 * The glass popup on Android. It renders through `PortalHost`, beside the root
 * layout's `GlassBlurTarget`, so its glass blurs the app behind it. The dialog
 * primitive closes it on a press outside the card or on the back button.
 *
 * Portal content renders under `PortalHost`, so the children only see the
 * providers above it in the root layout, not the screen that opened them.
 */
function PortalPopup({
    visible,
    onClose,
    title,
    children,
    contentStyle,
}: ModalPopupProps) {
    return (
        <DialogPrimitive.Root
            open={visible}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            // keep the empty root out of the caller's layout, like a Modal
            className="absolute"
        >
            <DialogPrimitive.Portal>
                {/* the dim and the card fade in and out together */}
                <NativeOnlyAnimatedView
                    entering={FadeIn.duration(200)}
                    exiting={FadeOut.duration(150)}
                    style={StyleSheet.absoluteFill}
                >
                    <DialogPrimitive.Overlay className={BACKDROP_CLASS}>
                        <DialogPrimitive.Content
                            className={CARD_CLASS}
                            style={contentStyle}
                        >
                            <GlassBackground />
                            {title ? (
                                <DialogPrimitive.Title asChild>
                                    <Text className={TITLE_CLASS}>{title}</Text>
                                </DialogPrimitive.Title>
                            ) : null}
                            {children}
                        </DialogPrimitive.Content>
                    </DialogPrimitive.Overlay>
                </NativeOnlyAnimatedView>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}

/** The card's glass, behind its content and out of the way of presses. */
function GlassBackground() {
    return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <GlassSurface variant="regular" style={StyleSheet.absoluteFill} />
        </View>
    );
}

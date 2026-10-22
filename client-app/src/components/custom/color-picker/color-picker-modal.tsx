import { useState } from "react";
import { Keyboard, Pressable, View, useWindowDimensions } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { GlassPill } from "@/components/ui/glass-pill";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { hexToHsv, hsvToHex, normalizeHex, type HSV } from "@/lib/color-math";

import { ColorWheel } from "./color-wheel";

const MAX_WHEEL_SIZE = 300;
/** Room the modal takes beside the wheel: backdrop and card padding. */
const WHEEL_INSET = 80;

type ColorPickerModalProps = {
    title: string;
    /** `#rrggbb` the picker opens on. */
    initialColor: string;
    onDone: (color: string) => void;
    onClose: () => void;
    /** Shows a Remove button, for editing a color that can be removed. */
    onRemove?: () => void;
};

/**
 * A large modal with a color wheel, a brightness slider, and a hex field.
 * Reports `#rrggbb` through `onDone`. Mount it to open it and unmount it to
 * close, so each opening starts from `initialColor`.
 *
 * Not tied to any one setting, so tag colors can use it the same way the
 * Appearance sheet does.
 */
export function ColorPickerModal({
    title,
    initialColor,
    onDone,
    onClose,
    onRemove,
}: ColorPickerModalProps) {
    const { width } = useWindowDimensions();
    const [hsv, setHsv] = useState<HSV>(() => hexToHsv(initialColor));
    // what the hex field shows while being typed in, before it is valid
    const [hexDraft, setHexDraft] = useState<string | null>(null);
    const color = hsvToHex(hsv);
    const wheelSize = Math.min(MAX_WHEEL_SIZE, width - WHEEL_INSET);

    // a tap outside the keyboard closes the keyboard first, and only a tap
    // with no keyboard up closes the picker
    function closeKeyboardOr(close: () => void) {
        if (Keyboard.isVisible()) Keyboard.dismiss();
        else close();
    }

    function pickOnWheel(next: HSV) {
        Keyboard.dismiss();
        setHsv(next);
    }

    function typeHex(text: string) {
        setHexDraft(text);
        const hex = normalizeHex(text);
        if (hex) setHsv(hexToHsv(hex));
    }

    return (
        <ModalPopup
            visible
            onClose={() => closeKeyboardOr(onClose)}
            title={title}
            contentStyle={{
                width: "100%",
                maxWidth: 440,
                gap: 20,
                padding: 20,
            }}
        >
            {/* the keyboard covers the bottom of the card rather than pushing
                it up. tapping the card outside a control closes the keyboard */}
            <Pressable
                accessible={false}
                onPress={Keyboard.dismiss}
                className="flex-row items-center gap-4"
            >
                <View
                    className="h-14 w-14 rounded-full border border-border"
                    style={{ backgroundColor: color }}
                />
                <View className="flex-1 gap-1">
                    <Text className="text-sm text-muted-foreground">Hex</Text>
                    <Input
                        value={hexDraft ?? color}
                        onChangeText={typeHex}
                        onBlur={() => setHexDraft(null)}
                        autoCapitalize="none"
                        autoCorrect={false}
                        maxLength={7}
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                        accessibilityLabel="Hex color"
                    />
                </View>
            </Pressable>

            <View className="items-center">
                <ColorWheel
                    value={hsv}
                    onChange={pickOnWheel}
                    size={wheelSize}
                />
            </View>

            <View className="flex-row items-center gap-2">
                {onRemove ? (
                    <GlassPill
                        icon="trash-outline"
                        label="Remove"
                        destructive
                        onPress={onRemove}
                    />
                ) : null}
                <View className="flex-1" />
                <GlassPill label="Cancel" onPress={onClose} />
                <GlassPill
                    icon="checkmark"
                    label="Done"
                    onPress={() => onDone(color)}
                />
            </View>
        </ModalPopup>
    );
}

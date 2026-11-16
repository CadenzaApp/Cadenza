import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef } from "react";
import { Keyboard, ScrollView, TextInput, View } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/lib/theme";

import {
    PostComposerFields,
    PostComposerSubmit,
    usePostComposer,
    type PostComposerOptions,
} from "./PostComposer";

/**
 * The feed's new post form. It is a keyboard-aware popup, so opening it never
 * reflows the feed beneath it and the focused field remains above the keyboard.
 */
export function InlinePostComposer({
    open,
    onOpenChange,
    onCreate,
}: Pick<PostComposerOptions, "onCreate"> & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { foreground } = useAppTheme().colors;
    const inputRef = useRef<TextInput>(null);
    const composer = usePostComposer({
        active: open,
        onCreate,
        onPosted: () => {
            Keyboard.dismiss();
            onOpenChange(false);
        },
    });

    useEffect(() => {
        if (open) inputRef.current?.focus();
    }, [open]);

    function cancel() {
        if (composer.isPosting()) return;
        Keyboard.dismiss();
        composer.reset();
        onOpenChange(false);
    }

    return (
        <ModalPopup
            visible={open}
            keyboardAware
            onClose={cancel}
            title="New post"
            contentStyle={{ width: "88%", maxWidth: 520, maxHeight: "88%" }}
        >
            <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerClassName="gap-3"
                showsVerticalScrollIndicator={false}
            >
                <View className="flex-row items-center gap-2">
                    <Ionicons
                        name="create-outline"
                        size={20}
                        color={foreground}
                    />
                    <Text
                        className="text-base font-semibold"
                        style={{ color: foreground }}
                    >
                        Share something
                    </Text>
                </View>
                <View className="gap-5 pb-4">
                    <PostComposerFields
                        composer={composer}
                        autoFocus
                        inputRef={inputRef}
                        minHeight={96}
                        highContrast
                    />
                    <PostComposerSubmit
                        composer={composer}
                        onCancel={cancel}
                        highContrast
                    />
                </View>
            </ScrollView>
        </ModalPopup>
    );
}

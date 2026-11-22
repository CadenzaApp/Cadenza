import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, TextInput, View } from "react-native";
import Animated, {
    LinearTransition,
    ReduceMotion,
} from "react-native-reanimated";

import { GlassPanel } from "@/components/ui/glass-panel";
import { Text } from "@/components/ui/text";
import { KEYBOARD_DURATION_MS, KEYBOARD_EASING } from "@/lib/keyboard-scroll";
import { useAppTheme } from "@/lib/theme";

import {
    PostComposerFields,
    PostComposerSubmit,
    usePostComposer,
    type PostComposerOptions,
} from "./PostComposer";

/**
 * How the composer grows or folds, on the keyboard's own timing and curve.
 * The feed hands the same one to its rows, so they slide with it.
 */
export const COMPOSER_LAYOUT = LinearTransition.duration(KEYBOARD_DURATION_MS)
    .easing(KEYBOARD_EASING)
    .reduceMotion(ReduceMotion.System);
const HIDDEN = { display: "none" } as const;

/**
 * The feed's new post prompt. Tapping it opens the composer in place, an
 * accordion rather than a dialog, while the keyboard comes up. The open state
 * lives here, so opening re-renders only this. It and the rows below animate
 * with layout transitions on the UI thread (`COMPOSER_LAYOUT`), not a layout
 * pass every frame. Cancel or posting folds it back.
 */
export function InlinePostComposer({
    onOpen,
    onCreate,
}: Pick<PostComposerOptions, "onCreate"> & {
    /** Called as it opens, for the feed to scroll it into place. */
    onOpen?: () => void;
}) {
    const { mutedForeground } = useAppTheme().colors;
    const inputRef = useRef<TextInput>(null);
    const [open, setOpen] = useState(false);

    // active from the start, so its lookups are loaded before the first tap
    // rather than starting as it opens
    const composer = usePostComposer({
        active: true,
        onCreate,
        onPosted: () => {
            Keyboard.dismiss();
            setOpen(false);
        },
    });

    // the keyboard starts up with the form, once the field exists
    useEffect(() => {
        if (open) inputRef.current?.focus();
    }, [open]);

    function cancel() {
        if (composer.isPosting()) return;
        Keyboard.dismiss();
        composer.reset();
        setOpen(false);
    }

    return (
        // clips the panel while its frame grows or folds
        <Animated.View
            layout={COMPOSER_LAYOUT}
            className="overflow-hidden rounded-3xl"
        >
            <GlassPanel>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Create a new post"
                    accessibilityState={{ expanded: open }}
                    disabled={open}
                    onPress={() => {
                        setOpen(true);
                        onOpen?.();
                    }}
                    className="flex-row items-center gap-3 px-4 py-3 active:opacity-60"
                >
                    <Ionicons
                        name="create-outline"
                        size={20}
                        color={mutedForeground}
                    />
                    <Text className="flex-1 text-base text-muted-foreground">
                        {open
                            ? "New post"
                            : "Talk about what you're listening to..."}
                    </Text>
                </Pressable>
                {/* always mounted, hidden while shut, so opening is one layout
                    change rather than building the whole form on the tap */}
                <View
                    className="gap-3 px-4 pb-4"
                    style={open ? undefined : HIDDEN}
                >
                    <PostComposerFields
                        composer={composer}
                        autoFocus={false}
                        inputRef={inputRef}
                        minHeight={96}
                    />
                    <PostComposerSubmit composer={composer} onCancel={cancel} />
                </View>
            </GlassPanel>
        </Animated.View>
    );
}

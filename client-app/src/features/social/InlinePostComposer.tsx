import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, TextInput, View } from "react-native";
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
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

const TIMING = { duration: KEYBOARD_DURATION_MS, easing: KEYBOARD_EASING };

/**
 * The feed's new post prompt. Tapping it opens the composer in place, an
 * accordion rather than a dialog: the form grows open on the keyboard's own
 * timing while the keyboard comes up, so the feed's scroll (see
 * `useKeyboardScroll`) and the form move as one. Its height animates on the
 * UI thread, so the posts below slide with it. Cancel or posting folds it
 * back.
 */
export function InlinePostComposer({
    open,
    onOpenChange,
    onCreate,
}: Pick<PostComposerOptions, "onCreate"> & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { mutedForeground } = useAppTheme().colors;
    const inputRef = useRef<TextInput>(null);
    // stays drawn while it folds shut
    const [shown, setShown] = useState(open);
    const progress = useSharedValue(open ? 1 : 0);
    const formHeight = useSharedValue(0);

    const composer = usePostComposer({
        active: open,
        onCreate,
        onPosted: () => {
            Keyboard.dismiss();
            onOpenChange(false);
        },
    });

    // set while rendering, so the form is there to grow on the same frame
    if (open && !shown) setShown(true);

    useEffect(() => {
        progress.set(
            withTiming(open ? 1 : 0, TIMING, (finished) => {
                if (finished && !open) runOnJS(setShown)(false);
            }),
        );
    }, [open, progress]);

    // the keyboard starts up with the form, once the field exists
    useEffect(() => {
        if (open && shown) inputRef.current?.focus();
    }, [open, shown]);

    const formStyle = useAnimatedStyle(() => ({
        height: progress.get() * formHeight.get(),
        opacity: progress.get(),
    }));

    function cancel() {
        if (composer.isPosting()) return;
        Keyboard.dismiss();
        composer.reset();
        onOpenChange(false);
    }

    return (
        <GlassPanel>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create a new post"
                accessibilityState={{ expanded: open }}
                disabled={open}
                onPress={() => onOpenChange(true)}
                className="flex-row items-center gap-3 px-4 py-3 active:opacity-60"
            >
                <Ionicons
                    name="create-outline"
                    size={20}
                    color={mutedForeground}
                />
                <Text className="flex-1 text-base text-muted-foreground">
                    {open ? "New post" : "Share what you're listening to..."}
                </Text>
            </Pressable>
            {shown ? (
                <Animated.View className="overflow-hidden" style={formStyle}>
                    {/* its own height, read for the animation above */}
                    <View
                        className="gap-3 px-4 pb-4"
                        onLayout={(event) => {
                            formHeight.set(event.nativeEvent.layout.height);
                        }}
                    >
                        <PostComposerFields
                            composer={composer}
                            autoFocus={false}
                            inputRef={inputRef}
                            minHeight={96}
                        />
                        <PostComposerSubmit
                            composer={composer}
                            onCancel={cancel}
                        />
                    </View>
                </Animated.View>
            ) : null}
        </GlassPanel>
    );
}

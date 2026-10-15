import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useState } from "react";
import { Pressable, TextInput, useWindowDimensions, View } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { GlassButton } from "@/components/ui/glass-button";
import { Text } from "@/components/ui/text";

const MAX_DIALOG_WIDTH = 400;
const SCREEN_MARGIN = 20;
const DIALOG_PADDING = 24;
const MAX_POST_LENGTH = 500;

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called with the trimmed body when the user posts. */
    onCreate: (content: string) => void | Promise<void>;
};

/** Compose dialog for a new feed post. Closes as soon as the user posts. */
export function CreatePostDialog({ open, onOpenChange, onCreate }: Props) {
    const { colors } = useTheme();
    const { width: screenWidth } = useWindowDimensions();
    const dialogWidth = Math.min(
        screenWidth - SCREEN_MARGIN * 2,
        MAX_DIALOG_WIDTH,
    );
    const [content, setContent] = useState("");

    function resetForm() {
        setContent("");
    }

    function setOpen(val: boolean) {
        if (!val) resetForm();
        onOpenChange(val);
    }

    function handlePost() {
        const trimmed = content.trim();
        if (!trimmed || trimmed.length > MAX_POST_LENGTH) return;
        void onCreate(trimmed);
        setOpen(false);
    }

    const trimmedLength = content.trim().length;
    const canPost = trimmedLength > 0 && trimmedLength <= MAX_POST_LENGTH;

    return (
        <ModalPopup
            visible={open}
            onClose={() => setOpen(false)}
            contentStyle={{
                width: dialogWidth,
                maxWidth: dialogWidth,
                padding: DIALOG_PADDING,
                gap: 14,
            }}
        >
            <Pressable
                onPress={() => setOpen(false)}
                hitSlop={12}
                className="absolute right-4 top-4 z-10 rounded opacity-70 active:opacity-100"
                accessibilityRole="button"
                accessibilityLabel="Close create post dialog"
            >
                <Ionicons name="close" size={18} color={colors.text} />
            </Pressable>

            <View className="pr-6">
                <Text className="text-lg font-semibold leading-none">
                    New post
                </Text>
            </View>

            <View className="overflow-hidden rounded-2xl border border-border">
                <TextInput
                    value={content}
                    onChangeText={(text) =>
                        setContent(text.slice(0, MAX_POST_LENGTH))
                    }
                    placeholder="What's on your mind?"
                    placeholderTextColor="#888888"
                    multiline
                    autoFocus
                    maxLength={MAX_POST_LENGTH}
                    textAlignVertical="top"
                    className="min-h-[120px] px-3 py-3 text-base text-foreground"
                />
            </View>

            <Text className="text-right text-xs text-muted-foreground">
                {content.length}/{MAX_POST_LENGTH}
            </Text>

            <GlassButton
                accessibilityLabel="Post"
                disabled={!canPost}
                onPress={handlePost}
            >
                <Text className="font-semibold">Post</Text>
            </GlassButton>
        </ModalPopup>
    );
}

import { ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ModalPopup } from "@/components/custom/modal-popup";
import { DialogCloseButton } from "@/components/ui/dialog-close-button";
import { Text } from "@/components/ui/text";

import {
    PostComposerFields,
    PostComposerSubmit,
    usePostComposer,
    type PostComposerOptions,
} from "./PostComposer";

const MAX_DIALOG_WIDTH = 400;
const SCREEN_MARGIN = 20;
const DIALOG_PADDING = 24;

type Props = Pick<
    PostComposerOptions,
    "onCreate" | "lockedTopic" | "lockedAttachment"
> & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Dialog heading. */
    title?: string;
    /** Submit button label. */
    submitLabel?: string;
};

/**
 * Compose dialog for a new post, for posting about something already picked,
 * like a shared playlist or the song playing. The feed composes inline
 * instead. The button spins until the post exists.
 */
export function CreatePostDialog({
    open,
    onOpenChange,
    onCreate,
    title = "New post",
    submitLabel = "Post",
    lockedTopic,
    lockedAttachment,
}: Props) {
    const insets = useSafeAreaInsets();
    const { width: screenWidth, height: screenHeight } = useWindowDimensions();
    const dialogWidth = Math.min(
        screenWidth - SCREEN_MARGIN * 2,
        MAX_DIALOG_WIDTH,
    );
    const composer = usePostComposer({
        active: open,
        onCreate,
        onPosted: () => onOpenChange(false),
        lockedTopic,
        lockedAttachment,
    });

    function close() {
        if (composer.isPosting()) return;
        composer.reset();
        onOpenChange(false);
    }

    const maxDialogHeight = screenHeight - insets.top - insets.bottom - 24;

    return (
        <ModalPopup
            visible={open}
            onClose={close}
            backdropClassName="justify-start py-0"
            contentStyle={{
                width: dialogWidth,
                maxWidth: dialogWidth,
                maxHeight: maxDialogHeight,
                padding: DIALOG_PADDING,
                marginTop: insets.top + 12,
            }}
        >
            <DialogCloseButton
                onPress={close}
                accessibilityLabel={
                    title === "New post"
                        ? "Close create post dialog"
                        : `Close ${title.toLowerCase()} dialog`
                }
            />

            <View className="mb-4 pr-6">
                <Text className="text-lg font-semibold leading-none">
                    {title}
                </Text>
            </View>

            <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                style={{ maxHeight: maxDialogHeight - 80 }}
            >
                <PostComposerFields composer={composer} />
            </ScrollView>

            <View className="mt-4">
                <PostComposerSubmit
                    composer={composer}
                    submitLabel={submitLabel}
                />
            </View>
        </ModalPopup>
    );
}

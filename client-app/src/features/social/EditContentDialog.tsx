import { useEffect, useState } from "react";
import { TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ModalPopup } from "@/components/custom/modal-popup";
import { Button } from "@/components/ui/button";
import { DialogCloseButton } from "@/components/ui/dialog-close-button";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/lib/theme";

const MAX_DIALOG_WIDTH = 400;
const SCREEN_MARGIN = 20;
const DIALOG_PADDING = 24;

type Props = {
    open: boolean;
    /** "Edit Post" or "Edit Comment". */
    title: string;
    initial: string;
    maxLength: number;
    saving: boolean;
    onSubmit: (content: string) => void;
    onCancel: () => void;
};

/** Modal for changing a post or comment. The row behind it stays as it is. */
export function EditContentDialog({
    open,
    title,
    initial,
    maxLength,
    saving,
    onSubmit,
    onCancel,
}: Props) {
    const { mutedForeground } = useAppTheme().colors;
    const insets = useSafeAreaInsets();
    const { width: screenWidth, height: screenHeight } = useWindowDimensions();
    const dialogWidth = Math.min(
        screenWidth - SCREEN_MARGIN * 2,
        MAX_DIALOG_WIDTH,
    );
    const [draft, setDraft] = useState(initial);
    const trimmed = draft.trim();
    const canSubmit =
        trimmed.length > 0 && trimmed.length <= maxLength && !saving;

    useEffect(() => {
        if (open) setDraft(initial);
    }, [open, initial]);

    function close() {
        if (saving) return;
        onCancel();
    }

    return (
        <ModalPopup
            visible={open}
            keyboardAware
            onClose={close}
            backdropClassName="justify-start py-0"
            contentStyle={{
                width: dialogWidth,
                maxWidth: dialogWidth,
                maxHeight: screenHeight - insets.top - insets.bottom - 24,
                padding: DIALOG_PADDING,
                marginTop: insets.top + 12,
            }}
        >
            <DialogCloseButton
                onPress={close}
                accessibilityLabel={`Close ${title} dialog`}
            />

            <View className="mb-4 pr-6">
                <Text className="text-lg font-semibold leading-none">
                    {title}
                </Text>
            </View>

            <View className="overflow-hidden rounded-2xl border border-border">
                <TextInput
                    value={draft}
                    onChangeText={(text) => setDraft(text.slice(0, maxLength))}
                    multiline
                    autoFocus
                    editable={!saving}
                    maxLength={maxLength}
                    textAlignVertical="top"
                    placeholderTextColor={mutedForeground}
                    className="min-h-[120px] px-3 py-3 text-base text-foreground"
                />
            </View>

            <Text className="mt-1.5 text-right text-xs text-muted-foreground">
                {draft.length}/{maxLength}
            </Text>

            <View className="mt-4 flex-row justify-end gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onPress={close}
                    disabled={saving}
                    accessibilityLabel="Cancel edit"
                >
                    <Text>Cancel</Text>
                </Button>
                <Button
                    size="sm"
                    onPress={() => onSubmit(trimmed)}
                    disabled={!canSubmit}
                    accessibilityLabel="Submit edit"
                >
                    <Text>Submit</Text>
                </Button>
            </View>
        </ModalPopup>
    );
}

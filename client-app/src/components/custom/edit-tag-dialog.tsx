import { useState } from "react";
import { ActivityIndicator, useWindowDimensions, View } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { TagColorPicker } from "@/components/custom/tag-color-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { tagMutationErrorMessage, useUpdateTag } from "@/lib/routes/tags";
import type { Tag } from "@/lib/types";

const MAX_DIALOG_WIDTH = 330;
const SCREEN_MARGIN = 20;
const DIALOG_PADDING = 24;

type EditMode = "name" | "color";

/** Renames or recolors an existing tag, depending on the selected option. */
export function EditTagDialog({
    tag,
    mode,
    onClose,
}: {
    tag: Tag;
    mode: EditMode;
    onClose: () => void;
}) {
    const { width: screenWidth } = useWindowDimensions();
    const { updateTag, updateTagErr, updateTagLoading } = useUpdateTag();
    const [name, setName] = useState(tag.name);
    const [color, setColor] = useState(tag.color);
    const dialogWidth = Math.min(
        screenWidth - SCREEN_MARGIN * 2,
        MAX_DIALOG_WIDTH,
    );
    const innerWidth = dialogWidth - DIALOG_PADDING * 2;
    const trimmedName = name.trim();
    const changed =
        mode === "name" ? trimmedName !== tag.name : color !== tag.color;

    async function save() {
        if (!changed || (mode === "name" && !trimmedName)) return;

        try {
            await updateTag(
                mode === "name"
                    ? { tag_id: tag.id, name: trimmedName }
                    : { tag_id: tag.id, color },
            );
            onClose();
        } catch {
            // The mutation hook owns the error shown below. Keeping the dialog
            // open lets the user correct the name or retry without an unhandled
            // promise rejection reaching React Native.
        }
    }

    return (
        <ModalPopup
            visible
            onClose={onClose}
            title={mode === "name" ? "Rename Tag" : "Change Tag Color"}
            contentStyle={{
                width: dialogWidth,
                maxWidth: dialogWidth,
                padding: DIALOG_PADDING,
                gap: 14,
            }}
        >
            {mode === "name" ? (
                <View className="gap-1.5">
                    <Label>Tag Name</Label>
                    <Input
                        value={name}
                        onChangeText={setName}
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={() => void save()}
                    />
                </View>
            ) : (
                <View className="gap-1.5">
                    <Label>Color</Label>
                    <TagColorPicker
                        width={innerWidth}
                        selectedColor={color}
                        onSelectColor={setColor}
                    />
                </View>
            )}

            {updateTagErr ? (
                <Text className="text-sm text-destructive">
                    {tagMutationErrorMessage(updateTagErr)}
                </Text>
            ) : null}

            <View className="flex-row gap-2.5">
                <Button
                    variant="secondary"
                    className="flex-1"
                    disabled={updateTagLoading}
                    onPress={onClose}
                >
                    <Text>Cancel</Text>
                </Button>
                <Button
                    className="flex-1"
                    disabled={
                        updateTagLoading ||
                        !changed ||
                        (mode === "name" && !trimmedName)
                    }
                    onPress={() => void save()}
                >
                    {updateTagLoading ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                        <Text>Save</Text>
                    )}
                </Button>
            </View>
        </ModalPopup>
    );
}

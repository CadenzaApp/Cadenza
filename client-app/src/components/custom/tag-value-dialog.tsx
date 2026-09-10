import { useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import {
    TAG_TYPE_LABELS,
    formatTagValue,
    toCanonicalTagValue,
    validateTagValue,
} from "@/lib/tag-values";
import { Tag } from "@/lib/types";

type TagValueDialogProps = {
    open: boolean;
    /** The tag whose value is being set. Never a basic tag. */
    tag: Tag | null;
    /** The value already on the song, when editing one. */
    initialValue?: string | null;
    /** "apply" puts the tag on the song, "edit" changes a value already there. */
    mode: "apply" | "edit";
    onSubmit: (value: string | null) => void;
    /** Offered in edit mode so the tag can be taken off from here. */
    onRemove?: () => void;
    onClose: () => void;
};

/**
 * Asks for the value to apply with an attribute tag, with an input matching
 * the tag's type. Leaving the input empty applies the tag with no value, which
 * is always allowed.
 *
 * Uses a plain `Modal` rather than the `Dialog` primitive so it can open on top
 * of the song detail modal and the expanded media player.
 */
export function TagValueDialog(props: TagValueDialogProps) {
    return (
        <TagValueDialogContent
            key={`${props.tag?.id ?? "no-tag"}:${props.initialValue ?? ""}`}
            {...props}
        />
    );
}

function TagValueDialogContent({
    open,
    tag,
    initialValue,
    mode,
    onSubmit,
    onRemove,
    onClose,
}: TagValueDialogProps) {
    const [rawValue, setRawValue] = useState(initialValue ?? "");
    const [pickerMode, setPickerMode] = useState<"date" | "time" | null>(null);

    // the dialog is remounted per tag, so this only resets when reopened for
    // the same tag and value
    useEffect(() => {
        if (!open) setPickerMode(null);
    }, [open]);

    if (!tag) return null;

    const validationErr = validateTagValue(tag.type, rawValue);
    const pickedDate = rawValue ? new Date(rawValue) : new Date();
    const hasValidDate = !Number.isNaN(pickedDate.getTime());

    function handleSubmit() {
        if (validationErr) return;
        onSubmit(toCanonicalTagValue(tag!.type, rawValue));
    }

    return (
        <Modal
            visible={open}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <Pressable
                className="flex-1 bg-black/70 items-center justify-center px-4 py-8"
                onPress={onClose}
            >
                <Pressable
                    onPress={(event) => event.stopPropagation()}
                    className="w-full max-w-[420px] bg-popover border border-border rounded-xl p-5 gap-4"
                >
                    <View className="gap-1">
                        <Text className="text-lg font-semibold text-foreground">
                            {mode === "apply" ? "Add" : "Edit"} {tag.name}
                        </Text>
                        <Text className="text-sm text-muted-foreground">
                            {TAG_TYPE_LABELS[tag.type]} tag. Leave this empty to
                            {mode === "apply" ? " add" : " keep"} the tag
                            without a value.
                        </Text>
                    </View>

                    <View className="gap-1.5">
                        <Label>Value</Label>

                        {tag.type === "text" && (
                            <Input
                                value={rawValue}
                                onChangeText={setRawValue}
                                placeholder="e.g. Live at Budokan"
                                returnKeyType="done"
                                autoFocus
                            />
                        )}

                        {tag.type === "number" && (
                            <Input
                                value={rawValue}
                                onChangeText={setRawValue}
                                placeholder="e.g. 7 or -2.5"
                                keyboardType="numeric"
                                returnKeyType="done"
                                autoFocus
                            />
                        )}

                        {tag.type === "checkbox" && (
                            <View className="flex-row gap-2">
                                {["true", "false"].map((option) => {
                                    const isSelected = rawValue === option;
                                    return (
                                        <Button
                                            key={option}
                                            variant={
                                                isSelected
                                                    ? "default"
                                                    : "secondary"
                                            }
                                            className="flex-1"
                                            onPress={() => setRawValue(option)}
                                        >
                                            <Text>
                                                {option === "true"
                                                    ? "True"
                                                    : "False"}
                                            </Text>
                                        </Button>
                                    );
                                })}
                            </View>
                        )}

                        {tag.type === "datetime" && (
                            <View className="gap-2">
                                <View className="flex-row gap-2">
                                    <Button
                                        variant="secondary"
                                        className="flex-1"
                                        onPress={() => setPickerMode("date")}
                                    >
                                        <Text>Pick date</Text>
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        className="flex-1"
                                        onPress={() => setPickerMode("time")}
                                    >
                                        <Text>Pick time</Text>
                                    </Button>
                                </View>
                                <Text className="text-sm text-foreground">
                                    {rawValue
                                        ? formatTagValue("datetime", rawValue)
                                        : "No date selected"}
                                </Text>
                                {pickerMode && (
                                    <DateTimePicker
                                        value={
                                            hasValidDate
                                                ? pickedDate
                                                : new Date()
                                        }
                                        mode={pickerMode}
                                        onChange={(event, selectedDate) => {
                                            setPickerMode(null);
                                            if (
                                                event.type === "dismissed" ||
                                                !selectedDate
                                            ) {
                                                return;
                                            }
                                            setRawValue(
                                                selectedDate.toISOString(),
                                            );
                                        }}
                                    />
                                )}
                            </View>
                        )}

                        {validationErr && (
                            <Text className="text-destructive text-sm">
                                {validationErr}
                            </Text>
                        )}

                        {rawValue !== "" && (
                            <Pressable
                                onPress={() => setRawValue("")}
                                hitSlop={6}
                                className="self-start"
                            >
                                <Text className="text-muted-foreground text-sm underline">
                                    Clear value
                                </Text>
                            </Pressable>
                        )}
                    </View>

                    <View className="flex-row gap-2.5">
                        <Button
                            variant="secondary"
                            onPress={onClose}
                            className="flex-1"
                        >
                            <Text>Cancel</Text>
                        </Button>
                        <Button
                            onPress={handleSubmit}
                            disabled={validationErr != null}
                            className="flex-1"
                        >
                            <Text>{mode === "apply" ? "Add tag" : "Save"}</Text>
                        </Button>
                    </View>

                    {mode === "edit" && onRemove && (
                        <Button variant="ghost" onPress={onRemove}>
                            <Text className="text-destructive">
                                Remove tag from song
                            </Text>
                        </Button>
                    )}
                </Pressable>
            </Pressable>
        </Modal>
    );
}

import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, View } from "react-native";
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

const CHECKBOX_SIZE = 26;

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
    // One button picks both date and time. iOS has a combined "datetime"
    // picker; Android's native pickers only do one or the other, so there we
    // run the date step and then the time step off that single press.
    const [pickerStep, setPickerStep] = useState<"date" | "time" | null>(null);
    // The day chosen in the Android date step, waiting for a time.
    const [pendingDate, setPendingDate] = useState<Date | null>(null);

    // the dialog is remounted per tag, so this only resets when reopened for
    // the same tag and value
    useEffect(() => {
        if (!open) {
            setPickerStep(null);
            setPendingDate(null);
        }
    }, [open]);

    if (!tag) return null;

    const validationErr = validateTagValue(tag.type, rawValue);
    const pickedDate = rawValue ? new Date(rawValue) : new Date();
    const hasValidDate = !Number.isNaN(pickedDate.getTime());
    /** What the picker opens on: the current value, else now. */
    const pickerBasisDate = hasValidDate ? pickedDate : new Date();

    /** Only an explicit "true" is checked; an unset value reads as unchecked. */
    const isChecked = rawValue === "true";

    /** An empty box steps from zero; anything unparseable can't step at all. */
    const canStep =
        rawValue.trim() === "" || Number.isFinite(Number(rawValue.trim()));

    /**
     * Nudges the value by one, keeping however many decimal places the user
     * already typed so 2.5 goes to 3.5 rather than 3.5000000000000004.
     */
    function stepValue(delta: number) {
        const trimmed = rawValue.trim();
        const base = trimmed === "" ? 0 : Number(trimmed);
        if (!Number.isFinite(base)) return;

        const decimals = (trimmed.split(".")[1] ?? "").length;
        const next = base + delta;
        setRawValue(decimals > 0 ? next.toFixed(decimals) : String(next));
    }

    function handleSubmit() {
        if (validationErr) return;
        onSubmit(toCanonicalTagValue(tag!.type, rawValue));
    }

    /**
     * Android runs two native dialogs back to back: the day picked in the
     * first is held in `pendingDate` and the time from the second is merged
     * into it, so the user only ever presses one button.
     */
    function handleAndroidPickerChange(
        eventType: string,
        selected?: Date,
    ) {
        if (eventType === "dismissed" || !selected) {
            setPickerStep(null);
            setPendingDate(null);
            return;
        }

        if (pickerStep === "date") {
            setPendingDate(selected);
            setPickerStep("time");
            return;
        }

        const combined = new Date(pendingDate ?? selected);
        combined.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
        setRawValue(combined.toISOString());
        setPendingDate(null);
        setPickerStep(null);
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
                    <Text className="text-lg font-semibold text-foreground">
                        {mode === "apply" ? "Add" : "Edit"} {tag.name}
                    </Text>

                    <View className="gap-1.5">
                        <Label>{TAG_TYPE_LABELS[tag.type]}</Label>

                        {tag.type === "text" && (
                            <Input
                                value={rawValue}
                                onChangeText={setRawValue}
                                placeholder="Enter text here"
                                returnKeyType="done"
                                autoFocus
                            />
                        )}

                        {tag.type === "number" && (
                            <View className="flex-row items-center gap-2">
                                <Button
                                    variant="secondary"
                                    className="h-10 w-12"
                                    disabled={!canStep}
                                    accessibilityLabel="Decrease by one"
                                    onPress={() => stepValue(-1)}
                                >
                                    <Text className="text-xl leading-6">
                                        −
                                    </Text>
                                </Button>
                                <View className="flex-1">
                                    <Input
                                        value={rawValue}
                                        onChangeText={setRawValue}
                                        placeholder="e.g. 7 or -2.5"
                                        keyboardType="numeric"
                                        returnKeyType="done"
                                        autoFocus
                                        className="text-center"
                                    />
                                </View>
                                <Button
                                    variant="secondary"
                                    className="h-10 w-12"
                                    disabled={!canStep}
                                    accessibilityLabel="Increase by one"
                                    onPress={() => stepValue(1)}
                                >
                                    <Text className="text-xl leading-6">
                                        +
                                    </Text>
                                </Button>
                            </View>
                        )}

                        {tag.type === "checkbox" && (
                            <Pressable
                                onPress={() =>
                                    setRawValue(
                                        rawValue === "true" ? "false" : "true",
                                    )
                                }
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: isChecked }}
                                hitSlop={6}
                                className="flex-row items-center gap-3 self-start py-1"
                            >
                                <View
                                    className={`items-center justify-center rounded-md border-2 ${
                                        isChecked
                                            ? "bg-primary border-primary"
                                            : "border-muted-foreground"
                                    }`}
                                    style={{
                                        width: CHECKBOX_SIZE,
                                        height: CHECKBOX_SIZE,
                                    }}
                                >
                                    {isChecked && (
                                        <Text
                                            className="text-primary-foreground font-bold"
                                            style={{
                                                fontSize: 15,
                                                lineHeight: 18,
                                            }}
                                        >
                                            ✓
                                        </Text>
                                    )}
                                </View>
                                <Text className="text-base text-foreground">
                                    {rawValue === ""
                                        ? "Not set"
                                        : isChecked
                                          ? "True"
                                          : "False"}
                                </Text>
                            </Pressable>
                        )}

                        {tag.type === "datetime" && (
                            <View className="gap-2">
                                {/* The button face is the chosen value, so it
                                    reads large instead of sitting in a small
                                    line underneath. */}
                                <Button
                                    variant="secondary"
                                    className="h-auto py-3"
                                    onPress={() => {
                                        setPendingDate(null);
                                        setPickerStep("date");
                                    }}
                                >
                                    <Text className="text-lg font-medium text-center">
                                        {rawValue
                                            ? formatTagValue(
                                                  "datetime",
                                                  rawValue,
                                              )
                                            : "Pick date & time"}
                                    </Text>
                                </Button>

                                {pickerStep &&
                                    (Platform.OS === "android" ? (
                                        <DateTimePicker
                                            value={
                                                pickerStep === "time"
                                                    ? (pendingDate ??
                                                      pickerBasisDate)
                                                    : pickerBasisDate
                                            }
                                            mode={pickerStep}
                                            onChange={(event, selectedDate) =>
                                                handleAndroidPickerChange(
                                                    event.type,
                                                    selectedDate,
                                                )
                                            }
                                        />
                                    ) : (
                                        <View className="gap-2">
                                            <DateTimePicker
                                                value={pickerBasisDate}
                                                mode="datetime"
                                                display="spinner"
                                                onChange={(_, selectedDate) => {
                                                    if (!selectedDate) return;
                                                    setRawValue(
                                                        selectedDate.toISOString(),
                                                    );
                                                }}
                                            />
                                            <Button
                                                variant="secondary"
                                                onPress={() =>
                                                    setPickerStep(null)
                                                }
                                            >
                                                <Text>Done</Text>
                                            </Button>
                                        </View>
                                    ))}
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

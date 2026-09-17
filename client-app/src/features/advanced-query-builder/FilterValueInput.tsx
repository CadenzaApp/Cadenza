import { useState } from "react";
import { Modal, Platform, Pressable, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { TAG_TYPES, TAG_TYPE_LABELS, formatTagValue } from "@/lib/tag-values";
import { TagType } from "@/lib/types";
import { cn } from "@/lib/utils";

import {
    parseDateTimeValue,
    parseDateValue,
    toDateTimeValue,
    toDateValue,
} from "./AdvancedQueryUtils";
import { OptionPicker } from "./OptionPicker";
import { TYPE_ICONS } from "./field-icons";
import { ValueKind } from "./types";

type Props = {
    kind: Exclude<ValueKind, "none">;
    value: string;
    onChange: (value: string) => void;
};

/** The value part of a filter line. Which input it shows depends on `kind`. */
export function FilterValueInput({ kind, value, onChange }: Props) {
    switch (kind) {
        case "text":
            return (
                <Input
                    value={value}
                    onChangeText={onChange}
                    placeholder="Empty"
                    autoCorrect={false}
                    returnKeyType="done"
                    className="h-10 w-44 rounded-none border-0 bg-transparent shadow-none"
                />
            );
        case "number":
            return (
                <Input
                    value={value}
                    onChangeText={onChange}
                    placeholder="0"
                    keyboardType="numeric"
                    returnKeyType="done"
                    className="h-10 w-24 rounded-none border-0 bg-transparent shadow-none"
                />
            );
        case "date":
            return <MomentValueInput value={value} onChange={onChange} />;
        case "datetime":
            return (
                <MomentValueInput withTime value={value} onChange={onChange} />
            );
        case "tag_type":
            return <TagTypeValueInput value={value} onChange={onChange} />;
    }
}

function ValueButton({
    label,
    placeholder,
    onPress,
}: {
    label: string | null;
    placeholder: string;
    onPress: () => void;
}) {
    return (
        <Pressable
            onPress={onPress}
            className="h-10 justify-center px-3 active:bg-accent"
        >
            <Text
                className={cn("text-base", !label && "text-muted-foreground")}
                numberOfLines={1}
            >
                {label ?? placeholder}
            </Text>
        </Pressable>
    );
}

/**
 * A calendar day, or with `withTime` a date and time. Android runs its native
 * date dialog, then the time dialog for `withTime`. iOS shows the inline
 * picker in a popup, since the compact picker cannot start out empty.
 */
function MomentValueInput({
    value,
    withTime = false,
    onChange,
}: {
    value: string;
    withTime?: boolean;
    onChange: (value: string) => void;
}) {
    const [step, setStep] = useState<"date" | "time" | null>(null);
    const picked = withTime ? parseDateTimeValue(value) : parseDateValue(value);
    const [draft, setDraft] = useState<Date>(picked ?? new Date());

    function openPicker() {
        setDraft(picked ?? new Date());
        setStep("date");
    }

    function commit(date: Date) {
        setStep(null);
        onChange(withTime ? toDateTimeValue(date) : toDateValue(date));
    }

    /** Android: the day from the first dialog waits in `draft` for a time. */
    function handleAndroidChange(selected: Date) {
        if (withTime && step === "date") {
            setDraft(selected);
            setStep("time");
            return;
        }
        if (withTime) {
            const combined = new Date(draft);
            combined.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
            commit(combined);
            return;
        }
        commit(selected);
    }

    const label = picked
        ? formatTagValue(withTime ? "datetime" : "date", value)
        : null;

    return (
        <>
            <ValueButton
                label={label}
                placeholder={withTime ? "Pick date & time" : "Pick date"}
                onPress={openPicker}
            />

            {step &&
                (Platform.OS === "android" ? (
                    <DateTimePicker
                        value={draft}
                        mode={step}
                        onValueChange={(_, selectedDate) =>
                            handleAndroidChange(selectedDate)
                        }
                        onDismiss={() => setStep(null)}
                    />
                ) : (
                    <Modal
                        visible
                        transparent
                        animationType="fade"
                        onRequestClose={() => setStep(null)}
                    >
                        <Pressable
                            className="flex-1 bg-black/70 items-center justify-center px-4 py-8"
                            onPress={() => setStep(null)}
                        >
                            <Pressable
                                onPress={(event) => event.stopPropagation()}
                                className="w-full max-w-[420px] bg-popover border border-border rounded-xl p-4 gap-3"
                            >
                                <DateTimePicker
                                    value={draft}
                                    mode={withTime ? "datetime" : "date"}
                                    display="inline"
                                    onValueChange={(_, selectedDate) =>
                                        setDraft(selectedDate)
                                    }
                                />
                                <View className="flex-row gap-2.5">
                                    <Button
                                        variant="secondary"
                                        className="flex-1"
                                        onPress={() => setStep(null)}
                                    >
                                        <Text>Cancel</Text>
                                    </Button>
                                    <Button
                                        className="flex-1"
                                        onPress={() => commit(draft)}
                                    >
                                        <Text>Done</Text>
                                    </Button>
                                </View>
                            </Pressable>
                        </Pressable>
                    </Modal>
                ))}
        </>
    );
}

function TagTypeValueInput({
    value,
    onChange,
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const label = (TAG_TYPES as string[]).includes(value)
        ? TAG_TYPE_LABELS[value as TagType]
        : null;

    return (
        <>
            <ValueButton
                label={label}
                placeholder="Pick type"
                onPress={() => setOpen(true)}
            />
            <OptionPicker
                visible={open}
                title="Tag type"
                selectedKey={value}
                sections={[
                    {
                        options: TAG_TYPES.map((type) => ({
                            key: type,
                            label: TAG_TYPE_LABELS[type],
                            icon: TYPE_ICONS[type],
                        })),
                    },
                ]}
                onSelect={(key) => {
                    setOpen(false);
                    onChange(key);
                }}
                onClose={() => setOpen(false)}
            />
        </>
    );
}

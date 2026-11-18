import { useState } from "react";
import MaskedView from "@react-native-masked-view/masked-view";
import { View, useWindowDimensions } from "react-native";
import { TimerPicker } from "react-native-timer-picker";
import { LinearGradient } from "expo-linear-gradient";
import { ModalPopup } from "@/components/custom/modal-popup";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { formatTagValue } from "@/lib/tag-values";
import { useAppTheme } from "@/lib/theme";

/** Cross-platform hours/minutes/seconds wheel. Values on the wire are milliseconds. */
export function DurationInput({
    value,
    onChange,
    compact = false,
}: {
    compact?: boolean;
    value: string;
    onChange: (value: string) => void;
}) {
    const { width } = useWindowDimensions();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(0);
    const [initialSeconds, setInitialSeconds] = useState(0);
    const { scheme } = useAppTheme();
    function show() {
        const seconds = Math.max(0, Math.floor((Number(value) || 0) / 1000));
        setDraft(seconds);
        setInitialSeconds(seconds);
        setOpen(true);
    }
    return (
        <>
            <Button
                variant="ghost"
                className="min-w-0 w-full px-2"
                onPress={show}
                accessibilityLabel="Choose duration"
            >
                <Text
                    className={
                        value
                            ? "shrink text-center text-sm text-foreground"
                            : "shrink text-center text-sm text-muted-foreground"
                    }
                >
                    {value
                        ? formatTagValue("duration", value)
                        : compact
                          ? "Choose…"
                          : "Choose duration"}
                </Text>
            </Button>
            <ModalPopup
                visible={open}
                onClose={() => setOpen(false)}
                title="Duration"
                contentStyle={{
                    width: Math.min(width - 40, 320),
                    minWidth: 0,
                    maxWidth: 320,
                }}
            >
                {open ? (
                    <View className="items-center py-4">
                        <TimerPicker
                            hideDays
                            hourLimit={{
                                min: 0,
                                max: Math.max(
                                    99,
                                    Math.floor(initialSeconds / 3600),
                                ),
                            }}
                            initialValue={{
                                hours: Math.floor(initialSeconds / 3600),
                                minutes: Math.floor(initialSeconds / 60) % 60,
                                seconds: initialSeconds % 60,
                            }}
                            onDurationChange={({ hours, minutes, seconds }) =>
                                setDraft(hours * 3600 + minutes * 60 + seconds)
                            }
                            LinearGradient={LinearGradient}
                            MaskedView={MaskedView}
                            hourLabel="h"
                            minuteLabel="m"
                            secondLabel="s"
                            styles={{
                                theme: scheme,
                                backgroundColor: "transparent",
                                pickerContainer: {
                                    alignSelf: "center",
                                    justifyContent: "center",
                                    width: 240,
                                },
                                pickerItem: { fontSize: 25 },
                                pickerLabel: { fontSize: 16 },
                                pickerColumnWidth: 65,
                            }}
                        />
                    </View>
                ) : null}
                <View className="flex-row justify-end gap-2">
                    <Button variant="ghost" onPress={() => setOpen(false)}>
                        <Text>Cancel</Text>
                    </Button>
                    <Button
                        onPress={() => {
                            onChange(String(draft * 1000));
                            setOpen(false);
                        }}
                    >
                        <Text>Done</Text>
                    </Button>
                </View>
            </ModalPopup>
        </>
    );
}

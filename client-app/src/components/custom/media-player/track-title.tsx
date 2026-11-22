import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { DialogCloseButton } from "@/components/ui/dialog-close-button";
import { Text } from "@/components/ui/text";

/** Two title lines, with a full-title popup only when more lines are needed. */
export function PlayerTrackTitle({
    title,
    compact,
}: {
    title: string;
    compact: boolean;
}) {
    const [width, setWidth] = useState(0);
    const [truncated, setTruncated] = useState(false);
    const [open, setOpen] = useState(false);
    const textClass = compact
        ? "text-lg font-bold text-foreground"
        : "text-2xl font-bold text-foreground";

    return (
        <>
            <Pressable
                disabled={!truncated}
                accessibilityRole={truncated ? "button" : "text"}
                accessibilityLabel={title}
                accessibilityHint={
                    truncated ? "Show the full song title" : undefined
                }
                onPress={() => setOpen(true)}
                onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            >
                <Text
                    className={textClass}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                >
                    {title}
                </Text>
                {width > 0 ? (
                    <View
                        pointerEvents="none"
                        accessible={false}
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        className="absolute left-0 top-0 opacity-0"
                        style={{ width }}
                    >
                        <Text
                            className={textClass}
                            onTextLayout={(event) =>
                                setTruncated(event.nativeEvent.lines.length > 2)
                            }
                        >
                            {title}
                        </Text>
                    </View>
                ) : null}
            </Pressable>
            <ModalPopup
                visible={open}
                onClose={() => setOpen(false)}
                title="Song title"
                titleClassName="pr-10"
            >
                <DialogCloseButton
                    accessibilityLabel="Close song title"
                    onPress={() => setOpen(false)}
                />
                <ScrollView
                    className="max-h-80"
                    showsVerticalScrollIndicator={false}
                >
                    <Text className="text-lg text-foreground" selectable>
                        {title}
                    </Text>
                </ScrollView>
            </ModalPopup>
        </>
    );
}

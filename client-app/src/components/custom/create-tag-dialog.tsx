import { Plus } from "lucide-react-native";
import { useTheme } from "expo-router/react-navigation";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { FloatingBubble } from "@/components/custom/floating-bubble";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { useCreateTag } from "@/lib/routes/tags";

const COLOR_BOX_SIZE = 44;
const COLOR_OPTIONS: string[] = [
    "#da4a40",
    "#ce7129",
    "#e4ba25",
    "#73dd2c",
    "#25924f",
    "#26c2aa",
    "#1f93d6",
    "#3863d8",
    "#5644ce",
    "#963dd1",
    "#da34c1",
    "#d62f67",
];

export function CreateTagDialog() {
    const { createTag, createTagErr, createTagLoading, resetCreateTag } =
        useCreateTag();

    const { colors } = useTheme();
    const [open, _setOpen] = useState(false);
    const [name, setName] = useState("");
    const [selectedColor, setSelectedColor] = useState(COLOR_OPTIONS[0]);

    function resetForm() {
        resetCreateTag();
        setName("");
        setSelectedColor(COLOR_OPTIONS[0]);
    }

    function setOpen(val: boolean) {
        if (!val) resetForm();
        _setOpen(val);
    }

    async function handleCreate() {
        if (!name.trim()) return;

        await createTag({
            name: name.trim(),
            color: selectedColor,
        });
        setOpen(false);
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <FloatingBubble
                onPress={() => setOpen(true)}
                accessibilityLabel="Create a new tag"
            >
                <Plus size={28} color={colors.background} />
            </FloatingBubble>

            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create New Tag</DialogTitle>
                    <DialogDescription>
                        Give your tag a name and a color
                    </DialogDescription>
                </DialogHeader>

                <View className="gap-1.5 mb-4 mt-2">
                    <Label>Tag Name</Label>
                    <Input
                        value={name}
                        onChangeText={setName}
                        placeholder="e.g. Instrumental"
                        returnKeyType="done"
                    />
                </View>

                <View className="gap-1.5 mb-4">
                    <Label>Color</Label>
                    <View className="gap-2">
                        {[0, 1, 2].map((rowIndex) => (
                            <View key={rowIndex} className="flex-row gap-2">
                                {COLOR_OPTIONS.slice(
                                    rowIndex * 4,
                                    rowIndex * 4 + 4,
                                ).map((color) => {
                                    const isSelected = color === selectedColor;
                                    return (
                                        <Pressable
                                            key={color}
                                            onPress={() =>
                                                setSelectedColor(color)
                                            }
                                            className={`rounded-md items-center justify-center ${isSelected ? "border-2 border-foreground" : ""}`}
                                            style={{
                                                width: COLOR_BOX_SIZE,
                                                height: COLOR_BOX_SIZE,
                                                backgroundColor: color,
                                            }}
                                        />
                                    );
                                })}
                            </View>
                        ))}
                    </View>
                </View>

                {createTagErr && (
                    <Text className="text-destructive text-sm mb-2">
                        {JSON.stringify(createTagErr)}
                    </Text>
                )}

                <View className="flex-row gap-2.5 mt-1">
                    <Button
                        variant="secondary"
                        onPress={() => setOpen(false)}
                        disabled={createTagLoading}
                        className="flex-1"
                    >
                        <Text>Cancel</Text>
                    </Button>
                    <Button
                        onPress={handleCreate}
                        disabled={!name.trim() || createTagLoading}
                        className="flex-1"
                    >
                        {createTagLoading ? (
                            <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                            <Text>Create</Text>
                        )}
                    </Button>
                </View>
            </DialogContent>
        </Dialog>
    );
}

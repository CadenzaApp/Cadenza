import { useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    useWindowDimensions,
    View,
} from "react-native";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { Icon } from "@/components/ui/icon";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useCreateTag } from "@/lib/routes/tags";
import {
    TAG_TYPES,
    TAG_TYPE_DESCRIPTIONS,
    TAG_TYPE_LABELS,
} from "@/lib/tag-values";
import { TagType } from "@/lib/types";

// Light red used for the "Advanced" disclosure label + chevron.
const ADVANCED_COLOR = "#f07a72";

// DialogContent's `max-w-*` classes don't resolve on native, so the dialog
// sizes itself to its widest child. We give it an explicit width instead and
// derive every inner measurement from it.
const MAX_DIALOG_WIDTH = 330;
const SCREEN_MARGIN = 20;
const DIALOG_PADDING = 24; // p-6
const DIALOG_BORDER = 1;

// The chevron sits to the right of the word "Advanced", which itself starts
// flush with the "Tag Name" / "Color" labels above it.
const CHEVRON_SIZE = 16;
const CHEVRON_GAP = 4;

const COLOR_COLUMNS = 5;
const GRID_GAP = 8;

// 15 swatches laid out as 3 rows of 5: a full hue wheel plus two neutrals.
const COLOR_OPTIONS: string[] = [
    "#da4a40",
    "#ce7129",
    "#e4ba25",
    "#73dd2c",
    "#25924f",
    "#26c2aa",
    "#22b8cf",
    "#1f93d6",
    "#3863d8",
    "#5644ce",
    "#963dd1",
    "#da34c1",
    "#d62f67",
    "#8a5a3c",
    "#6b7280",
];

const COLOR_ROWS = Array.from(
    { length: Math.ceil(COLOR_OPTIONS.length / COLOR_COLUMNS) },
    (_, i) => i,
);

export function CreateTagDialog() {
    const {
        createTag, createTagErr, createTagLoading, resetCreateTag
    } = useCreateTag();

    const { width: screenWidth } = useWindowDimensions();

    const dialogWidth = Math.min(
        screenWidth - SCREEN_MARGIN * 2,
        MAX_DIALOG_WIDTH,
    );
    // Usable width inside the dialog's padding and border.
    const innerWidth = dialogWidth - (DIALOG_PADDING + DIALOG_BORDER) * 2;
    // Swatches stay square and together span the full inner width.
    const colorBoxSize =
        (innerWidth - GRID_GAP * (COLOR_COLUMNS - 1)) / COLOR_COLUMNS;

    const [open, _setOpen] = useState(false);
    const [name, setName] = useState("");
    const [selectedColor, setSelectedColor] = useState(COLOR_OPTIONS[0]);
    const [selectedType, setSelectedType] = useState<TagType>("basic");
    const [showAdvanced, setShowAdvanced] = useState(false);

    function resetForm() {
        resetCreateTag();
        setName("");
        setSelectedColor(COLOR_OPTIONS[0]);
        setSelectedType("basic");
        setShowAdvanced(false);
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
            type: selectedType,
        });
        setOpen(false);
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Pressable className="absolute bottom-7 right-5 w-14 h-14 rounded-full bg-primary items-center justify-center shadow-lg shadow-black/30">
                    <Text className="text-primary-foreground text-3xl font-light leading-9 mt-[-2px]">
                        +
                    </Text>
                </Pressable>
            </DialogTrigger>

            <DialogContent
                className="gap-3.5"
                style={{ width: dialogWidth, maxWidth: dialogWidth }}
            >
                <DialogHeader>
                    <DialogTitle>Create New Tag</DialogTitle>
                    <DialogDescription>
                        Give your tag a name and a color
                    </DialogDescription>
                </DialogHeader>

                <View className="gap-1.5">
                    <Label>Tag Name</Label>
                    <Input
                        value={name}
                        onChangeText={setName}
                        placeholder="e.g. Instrumental"
                        returnKeyType="done"
                    />
                </View>

                <View className="gap-1.5">
                    <Label>Color</Label>
                    <View style={{ gap: GRID_GAP }}>
                        {COLOR_ROWS.map((rowIndex) => (
                            <View
                                key={rowIndex}
                                className="flex-row"
                                style={{ gap: GRID_GAP }}
                            >
                                {COLOR_OPTIONS.slice(
                                    rowIndex * COLOR_COLUMNS,
                                    rowIndex * COLOR_COLUMNS + COLOR_COLUMNS,
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
                                                width: colorBoxSize,
                                                height: colorBoxSize,
                                                backgroundColor: color,
                                            }}
                                        />
                                    );
                                })}
                            </View>
                        ))}
                    </View>
                </View>

                <View>
                    <Pressable
                        onPress={() => setShowAdvanced((prev) => !prev)}
                        hitSlop={8}
                        className="flex-row items-center py-1 self-start"
                        style={{ gap: CHEVRON_GAP }}
                    >
                        <Text
                            className="text-sm font-medium"
                            style={{ color: ADVANCED_COLOR }}
                        >
                            Advanced
                        </Text>
                        <Icon
                            as={showAdvanced ? ChevronDown : ChevronRight}
                            size={CHEVRON_SIZE}
                            color={ADVANCED_COLOR}
                            style={{ color: ADVANCED_COLOR }}
                        />
                    </Pressable>

                    {showAdvanced && (
                        <View
                            className="gap-1.5 mt-1.5"
                            style={{ width: innerWidth }}
                        >
                            <Label>Type</Label>
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                keyboardShouldPersistTaps="handled"
                                className="flex-grow-0"
                                style={{ width: innerWidth }}
                                contentContainerClassName="flex-row gap-2 pr-2"
                            >
                                {TAG_TYPES.map((type) => {
                                    const isSelected = type === selectedType;
                                    return (
                                        <Pressable
                                            key={type}
                                            onPress={() =>
                                                setSelectedType(type)
                                            }
                                            className={`shrink-0 rounded-md border px-3 py-2 ${
                                                isSelected
                                                    ? "border-foreground bg-secondary"
                                                    : "border-border"
                                            }`}
                                        >
                                            <Text
                                                className={`text-sm ${
                                                    isSelected
                                                        ? "text-foreground font-medium"
                                                        : "text-muted-foreground"
                                                }`}
                                            >
                                                {TAG_TYPE_LABELS[type]}
                                            </Text>
                                        </Pressable>
                                    );
                                })}
                            </ScrollView>
                            <Text className="text-muted-foreground text-xs">
                                {TAG_TYPE_DESCRIPTIONS[selectedType]}. A tag's
                                type cannot be changed later.
                            </Text>
                        </View>
                    )}
                </View>

                {createTagErr && (
                    <Text className="text-destructive text-sm mb-2">
                        {JSON.stringify(createTagErr)}
                    </Text>
                )}

                <View className="flex-row gap-2.5 mt-0.5">
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

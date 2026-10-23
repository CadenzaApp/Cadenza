import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { ScreenFloatingBubble } from "@/components/custom/floating-bubble";
import { ModalPopup } from "@/components/custom/modal-popup";
import {
    OptionPicker,
    type PickerOption,
    type PickerSection,
} from "@/components/custom/option-picker";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { METADATA_KEY_LABELS, type MetadataKey } from "@/lib/query-json";
import {
    useActivityTags,
    useDefaultTags,
    useUserTags,
} from "@/lib/routes/tags";
import {
    defaultDirection,
    directionLabels,
    fieldKey,
    fieldType,
    hasDirection,
    isArranged,
    type ArrangeDirection,
    type ArrangeField,
    type ArrangeTagSource,
    type SongArrangement,
} from "@/lib/song-arrangement";
import { METADATA_TAG_COLOR } from "@/lib/song-metadata-tags";
import { TAG_TYPE_ICONS } from "@/lib/tag-values";
import type { Tag } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The song's metadata tags, in the same order the query builder offers them. */
const METADATA_KEYS: readonly MetadataKey[] = [
    "title",
    "artist",
    "album",
    "genre",
    "release_date",
    "duration",
    "explicit",
    "total_plays",
];
const NONE_KEY = "none";
/** How many suggested tags the picker lists for its search. */
const SUGGESTED_TAG_LIMIT = 25;

type Choice = "sort" | "group";

type Props = {
    value: SongArrangement;
    onChange: (arrangement: SongArrangement) => void;
};

/**
 * The floating button that opens a list's Sort by and Group by choices. Both
 * pick any tag at all, the song's metadata tags included, from a searchable
 * list, or None. Picking a field starts it in its natural direction; the
 * direction buttons below it flip that.
 */
export function MusicListArrangeButton({ value, onChange }: Props) {
    const { colors } = useTheme();
    const [open, setOpen] = useState(false);
    const arranged = isArranged(value);

    return (
        <>
            <ScreenFloatingBubble
                onPress={() => setOpen(true)}
                accessibilityLabel={
                    arranged ? "Sort and group, on" : "Sort and group"
                }
                accessibilityState={{ expanded: open }}
            >
                <Ionicons
                    name={arranged ? "funnel" : "funnel-outline"}
                    size={28}
                    color={colors.text}
                />
            </ScreenFloatingBubble>

            {open ? (
                <ArrangeSheet
                    value={value}
                    onChange={onChange}
                    onClose={() => setOpen(false)}
                />
            ) : null}
        </>
    );
}

function ArrangeSheet({
    value,
    onChange,
    onClose,
}: Props & { onClose: () => void }) {
    const [picking, setPicking] = useState<Choice | null>(null);
    const [search, setSearch] = useState("");
    const fields = useArrangeFields(search, picking !== null);

    function pick(choice: Choice, key: string) {
        setPicking(null);
        setSearch("");
        const field = key === NONE_KEY ? null : fields.byKey.get(key);
        if (key !== NONE_KEY && !field) return;
        const next = field
            ? { field, direction: defaultDirection(field) }
            : null;
        onChange(
            choice === "sort"
                ? { ...value, sort: next }
                : { ...value, group: next },
        );
    }

    function setDirection(choice: Choice, direction: ArrangeDirection) {
        const current = choice === "sort" ? value.sort : value.group;
        if (!current) return;
        onChange({ ...value, [choice]: { ...current, direction } });
    }

    const pickingValue = picking === "sort" ? value.sort : value.group;

    return (
        <ModalPopup visible onClose={onClose} title="Sort and group">
            <View className="gap-4 pt-1">
                <ChoiceRow
                    title="Sort by"
                    choice={value.sort}
                    onPick={() => setPicking("sort")}
                    onDirection={(direction) => setDirection("sort", direction)}
                />
                <ChoiceRow
                    title="Group by"
                    choice={value.group}
                    onPick={() => setPicking("group")}
                    onDirection={(direction) =>
                        setDirection("group", direction)
                    }
                />
                {value.group ? (
                    <Text className="text-xs text-muted-foreground">
                        One section for each{" "}
                        {fieldLabel(value.group.field).toLowerCase()} value.
                        Sort by orders the songs inside each.
                    </Text>
                ) : null}
            </View>

            {/* inside the popup, so it presents over it rather than beside it */}
            <OptionPicker
                visible={picking !== null}
                title={picking === "group" ? "Group by" : "Sort by"}
                sections={fields.sections}
                selectedKey={
                    pickingValue ? fieldKey(pickingValue.field) : NONE_KEY
                }
                searchable
                onSearchChange={setSearch}
                emptyText="No tags match"
                onSelect={(key) => picking && pick(picking, key)}
                onClose={() => {
                    setPicking(null);
                    setSearch("");
                }}
            />
        </ModalPopup>
    );
}

function ChoiceRow({
    title,
    choice,
    onPick,
    onDirection,
}: {
    title: string;
    choice: { field: ArrangeField; direction: ArrangeDirection } | null;
    onPick: () => void;
    onDirection: (direction: ArrangeDirection) => void;
}) {
    const { colors } = useTheme();
    const icon = choice ? fieldIcon(choice.field) : null;

    return (
        <View className="gap-2">
            <Text className="text-sm font-semibold uppercase text-muted-foreground">
                {title}
            </Text>
            <Pressable
                onPress={onPick}
                accessibilityRole="button"
                accessibilityLabel={`${title}: ${choice ? fieldLabel(choice.field) : "None"}`}
                className="flex-row items-center gap-3 rounded-lg border border-border bg-background px-3 py-3 active:bg-accent"
            >
                <Ionicons
                    name={icon?.name ?? "remove-circle-outline"}
                    size={20}
                    color={icon?.color ?? colors.text}
                />
                <Text className="flex-1 text-sm" numberOfLines={1}>
                    {choice ? fieldLabel(choice.field) : "None"}
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.text} />
            </Pressable>
            {choice && hasDirection(choice.field) ? (
                <View className="flex-row gap-2">
                    {(["ascending", "descending"] as const).map((direction) => {
                        const selected = choice.direction === direction;
                        return (
                            <Button
                                key={direction}
                                variant={selected ? "secondary" : "ghost"}
                                className={cn(
                                    "h-10 flex-1 rounded-lg",
                                    selected && "border border-border",
                                )}
                                onPress={() => onDirection(direction)}
                                accessibilityState={{ selected }}
                            >
                                <Text className="text-sm" numberOfLines={1}>
                                    {directionLabels(choice.field)[direction]}
                                </Text>
                            </Button>
                        );
                    })}
                </View>
            ) : choice ? (
                <Text className="text-xs text-muted-foreground">
                    Songs with this tag come first.
                </Text>
            ) : null}
        </View>
    );
}

/** What a field is called on screen. */
function fieldLabel(field: ArrangeField): string {
    return field.kind === "tag" ? field.name : METADATA_KEY_LABELS[field.key];
}

function fieldIcon(field: ArrangeField) {
    return {
        name: TAG_TYPE_ICONS[fieldType(field)],
        color: field.kind === "tag" ? field.color : METADATA_TAG_COLOR,
    };
}

function tagField(tag: Tag, source: ArrangeTagSource): ArrangeField {
    return {
        kind: "tag",
        tagId: tag.id,
        name: tag.name,
        color: tag.color,
        type: tag.type,
        source,
    };
}

function option(field: ArrangeField): PickerOption {
    const icon = fieldIcon(field);
    return {
        key: fieldKey(field),
        label: fieldLabel(field),
        icon: icon.name,
        iconColor: icon.color,
    };
}

/**
 * Every field a list can be arranged by, as picker sections: None, then the
 * song's metadata tags and the activity tags, the user's own tags, and the
 * suggested tags matching `search`. `byKey` turns a picked key back into its
 * field. Suggested tags are only looked up while the picker is open.
 */
function useArrangeFields(search: string, open: boolean) {
    const { userTags } = useUserTags();
    const { activityTags } = useActivityTags();
    const { defaultTags } = useDefaultTags(
        search.trim(),
        open,
        SUGGESTED_TAG_LIMIT,
    );

    return useMemo(() => {
        const metadata: ArrangeField[] = METADATA_KEYS.map((key) => ({
            kind: "metadata",
            key,
        }));
        const activity = (activityTags ?? []).map((tag) =>
            tagField(tag, "activity"),
        );
        const own = [...(userTags ?? [])]
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((tag) => tagField(tag, "own"));
        const ownIds = new Set(own.map(fieldKey));
        // a suggested tag the user also owns under the same id cannot happen,
        // but a duplicate key would select both rows
        const suggested = (defaultTags ?? [])
            .map((tag) => tagField(tag, "suggested"))
            .filter((field) => !ownIds.has(fieldKey(field)));

        const sections: PickerSection[] = [
            {
                options: [
                    {
                        key: NONE_KEY,
                        label: "None",
                        icon: "remove-circle-outline",
                    },
                ],
            },
            {
                title: "Metadata",
                options: [...metadata, ...activity].map(option),
            },
            { title: "Your tags", options: own.map(option) },
            { title: "Suggested tags", options: suggested.map(option) },
        ];
        const byKey = new Map(
            [...metadata, ...activity, ...own, ...suggested].map((field) => [
                fieldKey(field),
                field,
            ]),
        );
        return { sections, byKey };
    }, [activityTags, defaultTags, userTags]);
}

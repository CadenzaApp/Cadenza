import { PLAYER_CONTROL_SIZE } from "@/lib/screen-overlay-geometry";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
    BOTTOM_ACTION_RIGHT_OFFSET,
    useBottomRowActionButton,
} from "@/lib/screen-overlay";
import { useTheme } from "expo-router/react-navigation";
import { useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { ScreenFloatingBubble } from "@/components/custom/floating-bubble";
import { ModalPopup } from "@/components/custom/modal-popup";
import {
    OptionPicker,
    type PickerOption,
    type PickerSection,
} from "@/components/custom/option-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    FloatingTopButton,
    HERO_BUTTON_SIZE,
} from "@/components/ui/floating-back-button";
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
    parseSongLimit,
    type ArrangeDirection,
    type ArrangeField,
    type ArrangeTagSource,
    type SongArrangement,
} from "@/lib/song-arrangement";
import { METADATA_TAG_COLOR } from "@/lib/song-metadata-tags";
import { TAG_TYPE_ICONS } from "@/lib/tag-values";
import type { Tag } from "@/lib/types";
import { cn } from "@/lib/utils";

import type { MusicListArrangePlacement } from "./types";

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
    /** See `MusicListArrangement`. */
    placement?: MusicListArrangePlacement;
};

/**
 * The button that opens a list's Sort by, Group by and Show top choices, in
 * the bottom row or the top right corner (`placement`). Sort and group both
 * pick any tag at all, the song's metadata tags included, from a searchable
 * list, or None. Picking a field starts it in its natural direction; the
 * direction buttons below it flip that. Show top keeps only the first songs,
 * in the sort's order, before they are grouped.
 */
export function MusicListArrangeButton({
    value,
    onChange,
    placement = "bottom",
}: Props) {
    const { colors } = useTheme();
    const [open, setOpen] = useState(false);
    const arranged = isArranged(value);
    const openSort = useCallback(() => setOpen(true), []);
    const icon = arranged ? ("funnel" as const) : ("funnel-outline" as const);
    const label = arranged
        ? "Sort, group, and limit, on"
        : "Sort, group, and limit";

    return (
        <>
            {placement === "top-right" ? (
                <FloatingTopButton
                    side="right"
                    size={HERO_BUTTON_SIZE}
                    accessibilityLabel={label}
                    accessibilityState={{ expanded: open }}
                    onPress={openSort}
                >
                    <Ionicons name={icon} size={22} color={colors.text} />
                </FloatingTopButton>
            ) : (
                <BottomRowButton
                    icon={icon}
                    label={label}
                    expanded={open}
                    onPress={openSort}
                />
            )}

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

/**
 * The button in the shared bottom row, or floating on its own where the
 * screen has no row.
 */
function BottomRowButton({
    icon,
    label,
    expanded,
    onPress,
}: {
    icon: "funnel" | "funnel-outline";
    label: string;
    expanded: boolean;
    onPress: () => void;
}) {
    const { colors } = useTheme();
    const rowAction = useMemo(
        () => ({ expanded, onPress, icon, accessibilityLabel: label }),
        [expanded, onPress, icon, label],
    );
    const showLocal = useBottomRowActionButton(rowAction);
    if (!showLocal) return null;

    return (
        <ScreenFloatingBubble
            size={PLAYER_CONTROL_SIZE}
            bordered={false}
            shadow={false}
            rightOffset={BOTTOM_ACTION_RIGHT_OFFSET}
            onPress={onPress}
            accessibilityLabel={label}
            accessibilityState={{ expanded }}
        >
            <Ionicons name={icon} size={28} color={colors.text} />
        </ScreenFloatingBubble>
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
        <ModalPopup visible onClose={onClose} title="Sort, group, and limit">
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
                <LimitRow
                    limit={value.limit}
                    onChange={(limit) => onChange({ ...value, limit })}
                />
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

/**
 * How many songs the list keeps, typed as a number. Empty is every song. The
 * list only changes once typing is done (the keyboard's Done, or leaving the
 * field), so each digit does not fetch it again.
 */
function LimitRow({
    limit,
    onChange,
}: {
    limit: number | null;
    onChange: (limit: number | null) => void;
}) {
    const { colors } = useTheme();
    const [draft, setDraft] = useState(limit === null ? "" : String(limit));
    // a limit changed from outside the field shows in it. set while
    // rendering, React's way of keeping a value from an earlier render
    const [shownLimit, setShownLimit] = useState(limit);
    if (shownLimit !== limit) {
        setShownLimit(limit);
        setDraft(limit === null ? "" : String(limit));
    }

    function commit() {
        const next = parseSongLimit(draft);
        setDraft(next === null ? "" : String(next));
        if (next !== limit) onChange(next);
    }

    return (
        <View className="gap-2">
            <Text className="text-sm font-semibold uppercase text-muted-foreground">
                Show top
            </Text>
            <View className="flex-row items-center gap-2">
                <Input
                    value={draft}
                    onChangeText={(text) => setDraft(text.replace(/\D/g, ""))}
                    onEndEditing={commit}
                    onSubmitEditing={commit}
                    placeholder="All songs"
                    keyboardType="number-pad"
                    returnKeyType="done"
                    accessibilityLabel="Show top, number of songs"
                    className="h-12 flex-1 rounded-lg border border-border bg-background"
                />
                {limit !== null || draft !== "" ? (
                    <Pressable
                        onPress={() => {
                            setDraft("");
                            if (limit !== null) onChange(null);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Show all songs"
                        hitSlop={8}
                        className="h-12 w-12 items-center justify-center rounded-lg active:bg-accent"
                    >
                        <Ionicons
                            name="close-circle"
                            size={22}
                            color={colors.text}
                        />
                    </Pressable>
                ) : null}
            </View>
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

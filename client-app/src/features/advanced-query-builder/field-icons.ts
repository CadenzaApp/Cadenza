import { METADATA_KEY_LABELS } from "@/lib/query-json";
import { TAG_TYPE_ICONS } from "@/lib/tag-values";

import type { IconName } from "./OptionPicker";
import type { MetadataKey } from "./types";

/**
 * The icon shown next to a tag of each type. Lives in `@/lib/tag-values` so
 * `TagPill` uses the same icons.
 */
export const TYPE_ICONS = TAG_TYPE_ICONS;

/** The fields that look across every tag on a song, rather than one tag. */
export const PROPERTY_FIELDS = [
    { kind: "tag_name", label: "Tag name", icon: "pricetags-outline" },
    { kind: "tag_value", label: "Tag value", icon: "reader-outline" },
    { kind: "tag_type", label: "Tag type", icon: "shapes-outline" },
] as const satisfies readonly {
    kind: "tag_name" | "tag_value" | "tag_type";
    label: string;
    icon: IconName;
}[];

/**
 * The song info fields, from each song's Apple Music metadata rather than its
 * tags, in menu order.
 */
export const METADATA_FIELDS = (
    [
        { key: "title", icon: "musical-note-outline" },
        { key: "artist", icon: "person-outline" },
        { key: "album", icon: "disc-outline" },
        { key: "genre", icon: "musical-notes-outline" },
        { key: "release_date", icon: "calendar-outline" },
        { key: "duration", icon: "time-outline" },
        { key: "explicit", icon: "alert-circle-outline" },
        { key: "total_plays", icon: "play-outline" },
    ] as const satisfies readonly { key: MetadataKey; icon: IconName }[]
).map((field) => ({ ...field, label: METADATA_KEY_LABELS[field.key] }));

import { METADATA_KEY_LABELS } from "@/lib/query-json";
import { METADATA_TAG_COLOR } from "@/lib/song-metadata-tags";
import { TAG_TYPE_ICONS } from "@/lib/tag-values";
import type { TagType } from "@/lib/types";

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
 * The song's metadata fields, from its Apple Music metadata rather than its
 * tags, in menu order. Each one reads like an attribute tag of `type`, so it
 * gets that type's icon, in the same neutral color as its pill on the Tags
 * page.
 */
export const METADATA_FIELDS = (
    [
        { key: "title", type: "text" },
        { key: "artist", type: "text" },
        { key: "album", type: "text" },
        { key: "genre", type: "text" },
        { key: "release_date", type: "date" },
        { key: "duration", type: "number" },
        { key: "explicit", type: "checkbox" },
        { key: "total_plays", type: "number" },
    ] as const satisfies readonly { key: MetadataKey; type: TagType }[]
).map((field) => ({
    ...field,
    label: METADATA_KEY_LABELS[field.key],
    icon: TYPE_ICONS[field.type],
    iconColor: METADATA_TAG_COLOR,
}));

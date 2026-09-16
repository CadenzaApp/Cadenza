import { TAG_TYPE_ICONS } from "@/lib/tag-values";

import type { IconName } from "./OptionPicker";

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

import { TagType } from "@/lib/types";

import type { IconName } from "./OptionPicker";

/** The icon shown next to a tag of each type. */
export const TYPE_ICONS: Record<TagType, IconName> = {
    basic: "pricetag-outline",
    text: "text-outline",
    datetime: "time-outline",
    date: "calendar-outline",
    number: "calculator-outline",
    checkbox: "checkbox-outline",
};

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

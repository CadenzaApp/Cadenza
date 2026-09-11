import { TagType } from "@/lib/types";

/** Every tag type, in the order they are offered when creating a tag. */
export const TAG_TYPES: TagType[] = [
    "basic",
    "text",
    "datetime",
    "number",
    "checkbox",
];

export const TAG_TYPE_LABELS: Record<TagType, string> = {
    basic: "Basic",
    text: "Text",
    datetime: "Date & time",
    number: "Number",
    checkbox: "Checkbox",
};

export const TAG_TYPE_DESCRIPTIONS: Record<TagType, string> = {
    basic: "No value, just the tag itself",
    text: "Any text, like a note",
    datetime: "A date and time",
    number: "A whole number or decimal",
    checkbox: "True or false",
};

/** Attribute tags are every type other than basic: they can hold a value. */
export function isAttributeTag(type: TagType): boolean {
    return type !== "basic";
}

/**
 * Validates what the user typed for a tag of the given type, returning an
 * error message, or null when the input is acceptable.
 *
 * An empty input is always acceptable: an attribute tag may be applied with
 * no value at all.
 */
export function validateTagValue(type: TagType, raw: string): string | null {
    const value = raw.trim();
    if (!value) return null;

    switch (type) {
        case "basic":
            return "Basic tags cannot hold a value.";
        case "text":
            return null;
        case "number":
            return Number.isFinite(Number(value))
                ? null
                : "Enter a number, like 7 or -2.5.";
        case "datetime":
            return Number.isNaN(new Date(value).getTime())
                ? "Enter a valid date and time."
                : null;
        case "checkbox":
            return value === "true" || value === "false"
                ? null
                : "Enter true or false.";
    }
}

/**
 * Converts what the user typed into the canonical form the backend stores, or
 * null when there is no value. Assumes `validateTagValue` already passed.
 */
export function toCanonicalTagValue(
    type: TagType,
    raw: string,
): string | null {
    const value = raw.trim();
    if (!value || type === "basic") return null;

    switch (type) {
        case "text":
            return value;
        case "number":
            return String(Number(value));
        case "datetime":
            return new Date(value).toISOString();
        case "checkbox":
            return value === "true" ? "true" : "false";
    }
}

/** Renders a stored value for display next to the tag name. */
export function formatTagValue(
    type: TagType,
    value: string | null | undefined,
): string {
    if (!value) return "";

    switch (type) {
        case "basic":
            return "";
        case "text":
            return value;
        case "number":
            return value;
        case "checkbox":
            return value === "true" ? "True" : "False";
        case "datetime": {
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return value;
            return date.toLocaleString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
            });
        }
    }
}

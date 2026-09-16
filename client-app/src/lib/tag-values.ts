import { TagType } from "@/lib/types";

/** Every tag type, in the order they are offered when creating a tag. */
export const TAG_TYPES: TagType[] = [
    "basic",
    "text",
    "datetime",
    "date",
    "number",
    "checkbox",
];

export const TAG_TYPE_LABELS: Record<TagType, string> = {
    basic: "Basic",
    text: "Text",
    datetime: "Date & time",
    date: "Date",
    number: "Number",
    checkbox: "Checkbox",
};

export const TAG_TYPE_DESCRIPTIONS: Record<TagType, string> = {
    basic: "No value, just the tag itself",
    text: "Any text, like a note",
    datetime: "A date and time",
    date: "A calendar date, no time",
    number: "A whole number or decimal",
    checkbox: "True or false",
};

/** Attribute tags are every type other than basic: they can hold a value. */
export function isAttributeTag(type: TagType): boolean {
    return type !== "basic";
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses a date tag value (`YYYY-MM-DD`) as midnight local time, or null if
 * it is not a real day. `new Date("YYYY-MM-DD")` would read it as UTC, which
 * shows the previous day west of Greenwich.
 */
export function parseDateOnly(value: string): Date | null {
    const match = DATE_ONLY_PATTERN.exec(value.trim());
    if (!match) return null;

    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(year, month - 1, day);
    const isSameDay =
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day;
    return isSameDay ? date : null;
}

/** The local calendar day of `date`, as a date tag value (`YYYY-MM-DD`). */
export function toDateOnly(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
        case "date":
            return parseDateOnly(value) ? null : "Enter a valid date.";
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
        case "date":
            return toDateOnly(parseDateOnly(value)!);
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
        case "date": {
            const date = parseDateOnly(value);
            if (!date) return value;
            return date.toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
            });
        }
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

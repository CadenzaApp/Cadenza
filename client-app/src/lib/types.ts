/** What kind of value a tag can hold. Basic tags hold no value at all. */
export type TagType = "basic" | "text" | "datetime" | "number" | "checkbox";

export type Tag = {
    id: number;
    name: string;
    color: string;
    type: TagType;
};

/**
 * A tag as it appears on a song, carrying the value it was applied with.
 * Always null for basic tags, and null for an attribute tag applied without
 * a value.
 */
export type AppliedTag = Tag & {
    value: string | null;
};

export type TagMetadata = {
    count: number;
}

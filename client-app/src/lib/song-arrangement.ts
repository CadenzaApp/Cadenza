/**
 * How a song list is sorted and grouped: the user's choice, what the backend
 * takes, and what it hands back, made into sections a list can draw.
 *
 * To the user every field is a tag. A field is either a tag row (their own, an
 * activity tag, or a suggested tag) or one of the song's metadata tags, but the
 * picker shows them all the same way. The backend does the sorting and the
 * grouping; see `POST /queries/results` and `POST /queries/arrange` in
 * `backend-api/src/routes/README.md`.
 *
 * Pure, so `song-arrangement.test.ts` runs it under `node --test`.
 */

import type { MetadataKey } from "./query-json";
import type { TagType } from "./types";

export type ArrangeDirection = "ascending" | "descending";

/** Where a tag field's rows come from. Only changes how the picker files it. */
export type ArrangeTagSource = "own" | "activity" | "suggested";

/**
 * A field to sort or group by. A tag carries its name, color and type, so a
 * saved choice still reads right before the tag lists load, and a suggested
 * tag the picker's search found is still named after the search moves on.
 */
export type ArrangeField =
    | {
          kind: "tag";
          tagId: number;
          name: string;
          color: string;
          type: TagType;
          source: ArrangeTagSource;
      }
    | { kind: "metadata"; key: MetadataKey };

export type SongSort = { field: ArrangeField; direction: ArrangeDirection };
export type SongGrouping = { field: ArrangeField; direction: ArrangeDirection };

/** Both null is "None" for each: the list's own order, ungrouped. */
export type SongArrangement = {
    sort: SongSort | null;
    group: SongGrouping | null;
};

export const NO_ARRANGEMENT: SongArrangement = { sort: null, group: null };

export function isArranged(arrangement: SongArrangement): boolean {
    return arrangement.sort !== null || arrangement.group !== null;
}

/** The type each metadata tag reads as, the same as the query builder's. */
export const METADATA_TAG_TYPES: Record<MetadataKey, TagType> = {
    title: "text",
    artist: "text",
    album: "text",
    genre: "text",
    release_date: "date",
    duration: "number",
    explicit: "checkbox",
    total_plays: "number",
};

export function fieldType(field: ArrangeField): TagType {
    return field.kind === "tag" ? field.type : METADATA_TAG_TYPES[field.key];
}

/** A stable key for a field, the same one the picker selects by. */
export function fieldKey(field: ArrangeField): string {
    return field.kind === "tag"
        ? `tag:${field.tagId}`
        : `metadata:${field.key}`;
}

export function sameField(
    left: ArrangeField | null | undefined,
    right: ArrangeField | null | undefined,
): boolean {
    if (!left || !right) return left === right;
    return fieldKey(left) === fieldKey(right);
}

/** Activity tags whose natural first look is the newest or the most. */
const DESCENDING_ACTIVITY_TAGS = new Set(["my plays", "last played"]);

/**
 * The direction a field starts in when picked: most played first for play
 * counts, the latest first for Last Played, and the natural order for the rest.
 */
export function defaultDirection(field: ArrangeField): ArrangeDirection {
    if (field.kind === "metadata") {
        return field.key === "total_plays" ? "descending" : "ascending";
    }
    return field.source === "activity" &&
        DESCENDING_ACTIVITY_TAGS.has(field.name.trim().toLowerCase())
        ? "descending"
        : "ascending";
}

/** A basic tag is only on a song or not, so it has no direction to pick. */
export function hasDirection(field: ArrangeField): boolean {
    return fieldType(field) !== "basic";
}

/** What each direction reads as for a field of this type. */
export function directionLabels(
    field: ArrangeField,
): Record<ArrangeDirection, string> {
    switch (fieldType(field)) {
        case "number":
            return { ascending: "Low to high", descending: "High to low" };
        case "date":
        case "datetime":
            return { ascending: "Oldest first", descending: "Newest first" };
        case "checkbox":
            return { ascending: "True first", descending: "False first" };
        case "basic":
            return { ascending: "Tagged first", descending: "Tagged first" };
        default:
            return { ascending: "A to Z", descending: "Z to A" };
    }
}

/** The field as the backend takes it, with a direction. */
export type ArrangeFieldJSON =
    | { field: "tag"; tag_id: number; direction: ArrangeDirection }
    | { field: "metadata"; key: MetadataKey; direction: ArrangeDirection };

export function arrangeFieldJSON(choice: SongSort): ArrangeFieldJSON {
    return choice.field.kind === "tag"
        ? {
              field: "tag",
              tag_id: choice.field.tagId,
              direction: choice.direction,
          }
        : {
              field: "metadata",
              key: choice.field.key,
              direction: choice.direction,
          };
}

/** What a group holds, as the backend says. */
export type ArrangedGroupState = "value" | "no_value" | "not_applied";

export type ArrangedGroupJSON = {
    state: ArrangedGroupState;
    value: string | null;
    count: number;
};

/** One group of a list, with the ids that are in it, in order. */
export type SongSection = {
    /** Unique within the list. */
    key: string;
    label: string;
    count: number;
    songIds: string[];
};

/**
 * Cuts the ordered ids into the backend's groups. Each group is a run of
 * `count` ids, so they are sliced in turn; a short list (which should not
 * happen) just leaves the last groups short.
 */
export function sectionsOf(
    songIds: readonly string[],
    groups: readonly ArrangedGroupJSON[],
    field: ArrangeField,
): SongSection[] {
    let start = 0;
    return groups.map((group, index) => {
        const songIdsInGroup = songIds.slice(start, start + group.count);
        start += group.count;
        return {
            key: `${index}:${group.state}:${group.value ?? ""}`,
            label: groupLabel(group, field),
            count: songIdsInGroup.length,
            songIds: songIdsInGroup,
        };
    });
}

/** What a group is called on screen. */
export function groupLabel(
    group: Pick<ArrangedGroupJSON, "state" | "value">,
    field: ArrangeField,
): string {
    if (group.state === "not_applied") return "Not tagged";
    if (group.state === "no_value" || group.value == null) {
        return fieldType(field) === "basic" ? "Tagged" : "No value";
    }

    const value = group.value;
    if (field.kind === "metadata" && field.key === "explicit") {
        return value === "true" ? "Explicit" : "Clean";
    }
    if (field.kind === "metadata" && field.key === "duration") {
        return formatDuration(Number(value));
    }
    switch (fieldType(field)) {
        case "checkbox":
            return value === "true" ? "True" : "False";
        case "date":
        case "datetime":
            return formatDay(value);
        default:
            return value;
    }
}

/** `YYYY-MM-DD` as a day in words, like "Mar 1, 2024". */
export function formatDay(day: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!match) return day;
    const [, year, month, date] = match;
    const utc = new Date(
        Date.UTC(Number(year), Number(month) - 1, Number(date)),
    );
    return utc.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
}

/** Milliseconds as `m:ss`, or `h:mm:ss` past an hour. */
export function formatDuration(millis: number): string {
    if (!Number.isFinite(millis) || millis < 0) return String(millis);
    const totalSeconds = Math.round(millis / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
        : `${minutes}:${seconds}`;
}

/** A day as the backend takes it from a song's release date in epoch ms. */
export function releaseDay(
    epochMillis: number | undefined,
): string | undefined {
    if (epochMillis == null || !Number.isFinite(epochMillis)) return undefined;
    return new Date(epochMillis).toISOString().slice(0, 10);
}

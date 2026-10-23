/////////////////////////
// The tag a sorted list puts first on every row, so the value the list is
// sorted by is always in view. Pure, so it runs under `node --test`.
/////////////////////////

import { METADATA_KEY_LABELS } from "./query-json.ts";
import { METADATA_TAG_COLOR } from "./song-metadata-tags.ts";
import {
    groupLabel,
    type ArrangeField,
    type ArrangeTagSource,
    type SongSort,
} from "./song-arrangement.ts";
import type { Tag } from "./types";

/**
 * A sort's tag as a list's rows lead with it. A tag row (the user's own, an
 * activity tag, or a suggested tag) is the row's own pill moved to the front.
 * A metadata tag is a pill made on screen, with each song's value as the
 * backend sent it (`sort_value`), keyed by song id.
 */
export type SortLeadTag =
    | { kind: "tag"; tagId: number; source: ArrangeTagSource }
    | { kind: "value"; tag: Tag; values: ReadonlyMap<string, string> };

/** The id the made-up metadata pill carries, clear of every real tag's. */
const METADATA_LEAD_TAG_ID = -100;

/**
 * What a list sorted by `sort` leads its rows with, or null. Grouping alone
 * leads with nothing: the group's header says the value. Title and artist
 * lead with nothing either, since every row shows them already.
 */
export function sortLeadTag(
    sort: SongSort | null,
    sortValues: ReadonlyMap<string, string> | undefined,
): SortLeadTag | null {
    if (!sort) return null;
    const field = sort.field;
    if (field.kind === "tag") {
        return { kind: "tag", tagId: field.tagId, source: field.source };
    }
    if (field.key === "title" || field.key === "artist") return null;
    return {
        kind: "value",
        tag: {
            id: METADATA_LEAD_TAG_ID,
            // a length reads as m:ss on the pill, not in milliseconds
            name:
                field.key === "duration"
                    ? "Duration"
                    : METADATA_KEY_LABELS[field.key],
            color: METADATA_TAG_COLOR,
            // already worded for the pill, so it is shown as it is
            type: "text",
        },
        values: displayValues(sortValues, field),
    };
}

/** Each raw value worded the way the field's group headers word it. */
function displayValues(
    sortValues: ReadonlyMap<string, string> | undefined,
    field: ArrangeField,
): ReadonlyMap<string, string> {
    const values = new Map<string, string>();
    for (const [songId, value] of sortValues ?? []) {
        values.set(songId, groupLabel({ state: "value", value }, field));
    }
    return values;
}

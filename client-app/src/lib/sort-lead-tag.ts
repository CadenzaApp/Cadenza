/////////////////////////
// The tag a sorted list puts first on every row, so the value the list is
// sorted by is always in view. Pure, so it runs under `node --test`.
/////////////////////////

import { metadataTagPills } from "./song-metadata-tags.ts";
import {
    METADATA_TAG_TYPES,
    type ArrangeTagSource,
    type SongSort,
} from "./song-arrangement.ts";
import type { Tag } from "./types";

/**
 * A sort's tag as a list's rows lead with it. A tag row (the user's own, an
 * activity tag, or a suggested tag) is the row's own pill moved to the front.
 * A metadata tag is the same pill the song's Metadata Tags show, named, typed
 * and valued the same, with each song's value as the backend stores it
 * (`sort_value`), keyed by song id.
 */
export type SortLeadTag =
    | { kind: "tag"; tagId: number; source: ArrangeTagSource }
    | { kind: "value"; tag: Tag; values: ReadonlyMap<string, string> };

const NO_VALUES: ReadonlyMap<string, string> = new Map();

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
    // the Metadata Tags pill itself, so it reads exactly as it does there
    const [{ tag }] = metadataTagPills([
        { key: field.key, type: METADATA_TAG_TYPES[field.key], value: "" },
    ]);
    return { kind: "value", tag, values: sortValues ?? NO_VALUES };
}

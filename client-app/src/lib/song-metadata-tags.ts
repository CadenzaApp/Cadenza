/////////////////////////
// A song's metadata tags as pills, for the Metadata Tags section of the
// now-playing Tags page. Pure and import-light, so it can be unit tested with
// `node --test`.
/////////////////////////

import { METADATA_KEY_LABELS, type MetadataKey } from "./query-json.ts";
import type { MetadataTag, Tag } from "./types";

/** Every metadata pill shares one neutral color, apart from the user's tags. */
export const METADATA_TAG_COLOR = "#8E8E93";

/** The order keys are shown in, which is also where each pill's id comes from. */
const KEY_ORDER: MetadataKey[] = [
    "title",
    "artist",
    "album",
    "genre",
    "release_date",
    "duration",
    "explicit",
];

/** A metadata pill: a tag that exists only on screen, and the song's value. */
export type MetadataTagPill = {
    tag: Tag;
    value: string;
};

/**
 * The backend's metadata tags as pills, named the way the query builder names
 * the same fields. Ids are negative so they never collide with a real tag.
 */
export function metadataTagPills(
    tags: readonly MetadataTag[],
): MetadataTagPill[] {
    return tags.map(({ key, type, value }) => ({
        tag: {
            id: -(KEY_ORDER.indexOf(key) + 1),
            name: METADATA_KEY_LABELS[key],
            color: METADATA_TAG_COLOR,
            type,
        },
        value,
    }));
}

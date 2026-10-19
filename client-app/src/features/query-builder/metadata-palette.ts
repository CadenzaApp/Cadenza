import { METADATA_KEY_LABELS, type MetadataKey } from "../../lib/query-json.ts";
import { METADATA_TAG_COLOR } from "../../lib/song-metadata-tags.ts";
import type { Tag, TagType } from "../../lib/types.ts";

type MetadataPaletteTag = Tag & { metadataKey: MetadataKey };

const FIELDS: readonly { key: MetadataKey; type: TagType }[] = [
    { key: "title", type: "text" },
    { key: "artist", type: "text" },
    { key: "album", type: "text" },
    { key: "genre", type: "text" },
    { key: "release_date", type: "date" },
    { key: "duration", type: "number" },
    { key: "explicit", type: "checkbox" },
    { key: "total_plays", type: "number" },
];

// Negative ids keep these palette-only fields distinct from stored tags.
export const METADATA_PALETTE_TAGS: readonly MetadataPaletteTag[] = FIELDS.map(
    ({ key, type }, index) => ({
        id: -(index + 1),
        name: METADATA_KEY_LABELS[key],
        color: METADATA_TAG_COLOR,
        type,
        metadataKey: key,
    }),
);

export function isMetadataPaletteTag(tag: Tag): tag is MetadataPaletteTag {
    return (
        "metadataKey" in tag &&
        METADATA_PALETTE_TAGS.some(
            (field) =>
                field.id === tag.id && field.metadataKey === tag.metadataKey,
        )
    );
}

export function metadataPaletteTag(key: MetadataKey): MetadataPaletteTag {
    const tag = METADATA_PALETTE_TAGS.find(
        (field) => field.metadataKey === key,
    );
    if (!tag) throw new Error(`Unknown metadata field: ${key}`);
    return tag;
}

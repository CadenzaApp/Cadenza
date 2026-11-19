/**
 * Turns a `run_query` card into what the Cadenza tab shows when the card is
 * opened: the query loaded into the simple builder (or the advanced one), and
 * how its results are sorted, grouped and limited. Pure, so
 * `query-handoff.test.ts` runs it under `node --test`; `use-query-handoff.ts`
 * applies it.
 */

import { queryTagIds, type QueryJSON } from "../../lib/query-json.ts";
import type {
    ArrangeField,
    ArrangeFieldJSON,
    SongArrangement,
    SongSort,
} from "../../lib/song-arrangement.ts";
import type { Tag } from "../../lib/types.ts";
import type { QueryWorkspace } from "../cadenza/query-workspace.ts";
import {
    queryToAdvanced,
    queryToSimple,
} from "../query-builder/QueryImport.ts";
import type { AssistantCardQuery } from "./types.ts";

/** The tags a handed over query can name. */
export type HandoffTags = {
    own: readonly Tag[];
    activity: readonly Tag[];
};

export type QueryHandoff = {
    query: QueryJSON;
    /** The builder the query loads into. */
    mode: "simple" | "advanced";
    /** The `load` update: the query replaces the builder's drafts. */
    load: (current: QueryWorkspace) => QueryWorkspace;
    /** How the results open. */
    arrangement: SongArrangement;
};

function isQueryJSON(value: unknown): value is QueryJSON {
    return (
        typeof value === "object" &&
        value !== null &&
        "where" in value &&
        typeof (value as { where: unknown }).where === "object" &&
        (value as { where: unknown }).where !== null
    );
}

/** A sort or group as the backend took it, as the list picker holds it. */
function arrangeChoice(
    json: ArrangeFieldJSON | undefined,
    tags: HandoffTags,
): SongSort | null {
    if (!json) return null;
    let field: ArrangeField | null = null;
    if (json.field === "metadata") {
        field = { kind: "metadata", key: json.key };
    } else {
        const own = tags.own.find((tag) => tag.id === json.tag_id);
        const activity = tags.activity.find((tag) => tag.id === json.tag_id);
        const tag = own ?? activity;
        field = tag
            ? {
                  kind: "tag",
                  tagId: tag.id,
                  name: tag.name,
                  color: tag.color,
                  type: tag.type,
                  source: own ? "own" : "activity",
              }
            : null;
    }
    return field ? { field, direction: json.direction } : null;
}

/**
 * What opening `card` does, or null when the card cannot be handed over: its
 * query is not one, or names a tag the user cannot see (deleted since, say).
 * The card's builder is a preference: a query Simple cannot hold after all
 * goes to Advanced, which holds any query.
 */
export function prepareHandoff(
    card: AssistantCardQuery,
    tags: HandoffTags,
): QueryHandoff | null {
    if (!isQueryJSON(card.query)) return null;
    const query = card.query;
    const visible = new Map(
        [...tags.own, ...tags.activity].map((tag) => [tag.id, tag]),
    );
    if (queryTagIds(query).some((id) => !visible.has(id))) return null;

    const arrangement: SongArrangement = {
        sort: arrangeChoice(card.sort, tags),
        group: arrangeChoice(card.group, tags),
        limit:
            typeof card.limit === "number" && card.limit > 0
                ? card.limit
                : null,
    };
    const conditions =
        card.builder === "simple"
            ? queryToSimple(query, { tags: visible })
            : null;
    if (conditions) {
        const connector = conditions[0]?.rememberedNextConnector ?? "and";
        return {
            query,
            mode: "simple",
            load: (current) => ({
                ...current,
                mode: "simple",
                conditions,
                connector,
            }),
            arrangement,
        };
    }
    const advancedRoot = queryToAdvanced(query);
    return {
        query,
        mode: "advanced",
        load: (current) => ({
            ...current,
            mode: "advanced",
            advancedInitialized: true,
            advancedRoot,
        }),
        arrangement,
    };
}

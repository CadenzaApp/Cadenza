/** Shapes for `POST /assistant/messages`. See backend-api/src/routes/README.md. */

import type { ArrangeFieldJSON } from "../../lib/song-arrangement.ts";

export type ChatRole = "user" | "assistant";

export type AssistantRequest = {
    /** `song_ids` on an assistant message is its card, so a follow-up can mean "those songs". */
    messages: { role: ChatRole; content: string; song_ids?: string[] }[];
    time_zone?: string;
    now?: string;
    /** A phone tool's result: the last `client_tool_call`'s continuation, as it came, and the output. */
    resume?: { continuation: AssistantContinuation; output: unknown };
    /** The query builder's settings now, so a query the assistant runs matches the builder. */
    query_settings?: { library_or_tagged: boolean; include_suggested: boolean };
};

/** Where an answer stopped for a phone tool. Opaque here: sent back as it came. */
export type AssistantContinuation = Record<string, unknown>;

/** One status row: what the assistant did on the way to its answer. */
export type AssistantStep = {
    tool: string;
    label: string;
};

/** Songs a tool found, shown as a card under the answer. */
export type AssistantSongs = {
    song_ids: string[];
    /** How many matched in all, which can be more than `song_ids`. */
    total: number;
    /** The match itself was cut off, so `total` is a lower bound. */
    capped: boolean;
    /** A short name for the list, the title of the screen Open list shows. */
    title?: string;
    /** For a `run_query` card: the query, so opening the card loads it into the builder. */
    query?: AssistantCardQuery;
};

/**
 * A `run_query` card's query and everything that decided its songs, as the
 * backend's `CardQuery` sends it.
 */
export type AssistantCardQuery = {
    /** The query in the wire format, as the model wrote it. Checked before use. */
    query: unknown;
    builder: "simple" | "advanced";
    library_or_tagged: boolean;
    include_suggested: boolean;
    sort?: ArrangeFieldJSON;
    group?: ArrangeFieldJSON;
    limit?: number;
};

export type AssistantResponse =
    | {
          type: "reply";
          text: string;
          steps: AssistantStep[];
          songs?: AssistantSongs;
      }
    | {
          /** A tool only the phone can run. See `phone-tools.ts`. */
          type: "client_tool_call";
          call_id: string;
          name: string;
          arguments: Record<string, unknown>;
          continuation: AssistantContinuation;
      };

/** A phone tool waiting for the user's yes, shown as a card in the chat. */
export type PendingConfirmation = {
    title: string;
    detail: string;
    confirmLabel: string;
};

/** One message in the chat as the screen shows it. */
export type ChatEntry =
    | { id: string; role: "user"; text: string }
    | {
          id: string;
          role: "assistant";
          text: string;
          steps: AssistantStep[];
          songs?: AssistantSongs;
      };

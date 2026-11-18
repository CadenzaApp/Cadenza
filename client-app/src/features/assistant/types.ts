/** Shapes for `POST /assistant/messages`. See backend-api/src/routes/README.md. */

export type ChatRole = "user" | "assistant";

export type AssistantRequest = {
    /** `song_ids` on an assistant message is its card, so a follow-up can mean "those songs". */
    messages: { role: ChatRole; content: string; song_ids?: string[] }[];
    time_zone?: string;
    now?: string;
    /** A phone tool's result: the last `client_tool_call`'s continuation, as it came, and the output. */
    resume?: { continuation: AssistantContinuation; output: unknown };
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

/** Shapes for `POST /assistant/messages`. See backend-api/src/routes/README.md. */

export type ChatRole = "user" | "assistant";

export type AssistantRequest = {
    messages: { role: ChatRole; content: string }[];
    time_zone?: string;
    now?: string;
};

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
};

export type AssistantResponse =
    | {
          type: "reply";
          text: string;
          steps: AssistantStep[];
          songs?: AssistantSongs;
      }
    | {
          /** A tool only the phone can run. Not sent by the backend yet. */
          type: "client_tool_call";
          call_id: string;
          name: string;
          arguments: unknown;
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

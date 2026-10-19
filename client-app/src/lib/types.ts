import type { MetadataKey } from "./query-json";

/** What kind of value a tag can hold. Basic tags hold no value at all. */
export type TagType =
    | "basic"
    | "text"
    | "datetime"
    | "date"
    | "number"
    | "checkbox";

/**
 * One piece of a song's stored Apple Music metadata, from
 * `GET /songs/metadata-tags`. `key` is the key a metadata query filter takes,
 * and `type` says how to read `value`, the same as for an attribute tag.
 */
export type MetadataTag = {
    key: MetadataKey;
    type: TagType;
    value: string;
};

export type Tag = {
    id: number;
    name: string;
    color: string;
    type: TagType;
    /**
     * An activity tag, like "My Plays". Shared by every user, and its value on
     * a song is set by listening rather than by hand.
     */
    is_activity?: boolean;
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
};

/** What kind of thing the social feed tracks the user's interest in. */
export type InterestType = "artist" | "genre";

/**
 * How far to move the user's interest in one named artist or genre. A positive
 * `delta` raises it, a negative one lowers it.
 */
export type InterestScoreDelta = {
    name: string;
    itype: InterestType;
    delta: number;
};

/**
 * A song or artist attached to a social post. The wire only stores the
 * MusicKit catalog id; the client asks Apple whether that id is a song or
 * an artist.
 */
export type PostTopic =
    | {
          kind: "song";
          id: string;
          title: string;
          artistName?: string;
          artworkUrl?: string;
          artworkColor?: string;
          catalogId?: string;
          playbackId?: string;
          songDuration?: number;
          previewUrl?: string;
      }
    | {
          kind: "artist";
          id: string;
          name: string;
          artworkUrl?: string;
          artworkColor?: string;
          catalogId?: string;
      };

/**
 * One social feed post as `/social/feed`, `/social/posts/user/:id`, and
 * `/social/posts/topic` return it. Author comes from `profile`; a missing
 * profile row shows username `"unknown"`. `topic_mk_id` is the Apple Music
 * catalog id of an attached song or artist, or null.
 */
export type SocialPost = {
    post_id: number;
    content: string;
    likes: number;
    /** Whether the signed-in user has liked it. */
    liked: boolean;
    /** RFC 3339 in UTC */
    created_at: string;
    author: {
        /** Auth user id; used to open their profile page. */
        user_id: string;
        username: string;
    };
    /** Apple Music catalog id of the attached song or artist, or null. */
    topic_mk_id: string | null;
};

/** Public profile header from `GET /social/posts/user/:author_id`. */
export type SocialUserProfile = {
    user_id: string;
    username: string;
    bio: string;
};

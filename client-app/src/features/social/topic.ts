import { PlaybackQueueType, type MusicItem } from "@apple-musickit";
import { useMemo } from "react";

import { useArtist, useSongInfo } from "@/lib/musickit-hooks";
import type { PostTopic } from "@/lib/types";

/** The title a topic card shows: song title, or the artist's name. */
export function topicTitle(topic: PostTopic): string {
    return topic.kind === "song" ? topic.title : topic.name;
}

/** The subtitle a topic card shows: artist name, or the word Artist. */
export function topicSubtitle(topic: PostTopic): string {
    return topic.kind === "song" ? (topic.artistName ?? "") : "Artist";
}

/** Apple Music catalog id stored on the post row. */
export function topicMkId(topic: PostTopic): string {
    return topic.catalogId ?? topic.id;
}

/** Fields `POST /social/posts` needs so the embedding can name the topic. */
export function topicCreateFields(topic: PostTopic): {
    topic_mk_id: string;
    topic_song_title?: string;
    topic_artist_name?: string;
} {
    if (topic.kind === "song") {
        const title = topic.title.trim();
        const artist = topic.artistName?.trim();
        return {
            topic_mk_id: topicMkId(topic),
            ...(title ? { topic_song_title: title } : {}),
            ...(artist ? { topic_artist_name: artist } : {}),
        };
    }
    const name = topic.name.trim();
    return {
        topic_mk_id: topicMkId(topic),
        ...(name ? { topic_artist_name: name } : {}),
    };
}

export function topicFromSong(song: MusicItem): PostTopic {
    return {
        kind: "song",
        id: song.id,
        title: song.title,
        artistName: song.artistName,
        artworkUrl: song.artworkUrl,
        artworkColor: song.artworkColor,
        catalogId: song.catalogId,
        playbackId: song.playbackId,
        songDuration: song.songDuration,
        previewUrl: song.previewUrl,
    };
}

export function topicFromArtist(artist: {
    id: string;
    name: string;
    artworkUrl?: string;
    artworkColor?: string;
    catalogId?: string;
}): PostTopic {
    return {
        kind: "artist",
        id: artist.id,
        name: artist.name,
        artworkUrl: artist.artworkUrl,
        artworkColor: artist.artworkColor,
        catalogId: artist.catalogId ?? artist.id,
    };
}

/** Enough of a `MusicItem` to play a song topic through the shared player. */
export function musicItemFromSongTopic(
    topic: Extract<PostTopic, { kind: "song" }>,
): MusicItem {
    const catalogId = topic.catalogId ?? topic.id;
    return {
        id: topic.id,
        catalogId,
        playbackId: topic.playbackId ?? catalogId,
        title: topic.title,
        artistName: topic.artistName,
        artworkUrl: topic.artworkUrl,
        artworkColor: topic.artworkColor,
        resourceKind: "song",
        source: "catalog",
        playbackType: PlaybackQueueType.Song,
        songDuration: topic.songDuration,
        previewUrl: topic.previewUrl,
    };
}

/**
 * Resolves a post's stored MusicKit id into a song or artist. `hint` is the
 * full topic from compose, used when the client already has it. Kind is not
 * stored on the post: a miss from `getSongInfo` falls through to `getArtist`.
 */
export function useResolvedTopic(
    topicMkId?: string | null,
    hint?: PostTopic | null,
): PostTopic | null {
    const id = topicMkId?.trim() || null;
    const { songInfo, songInfoLoading, songInfoErr } = useSongInfo(
        id && !hint ? [id] : null,
    );
    const song = useMemo(() => {
        if (!id) return undefined;
        return songInfo.find(
            (item) => item.id === id || item.catalogId === id,
        );
    }, [id, songInfo]);
    const tryArtist =
        Boolean(id) &&
        !hint &&
        !song &&
        !songInfoLoading &&
        songInfoErr == null;
    const { artist } = useArtist(id && tryArtist ? id : undefined);

    if (hint) return hint;
    if (song) return topicFromSong(song);
    if (artist) return topicFromArtist(artist);
    return null;
}

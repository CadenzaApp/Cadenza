import { useState } from "react";

import { useApplyTag, useTagsOnSong, useUnapplyTag } from "@/lib/routes/songs";
import { useUserTags } from "@/lib/routes/tags";
import type { Tag } from "@/lib/types";

export type EditableSongTag = Tag & { applied: boolean };

/**
 * Tag editing for one song, independent of whether it is playing: the data
 * behind it, not the layout. Every one of the user's tags, annotated with
 * whether it is applied, the toggle mutation, and the "New" tag dialog's open
 * state. `media-player/tags-page.tsx` (the now-playing sheet's Tags page) is
 * the one caller; it owns the page itself.
 */
export function useSongTagEditor(songId: string) {
    const { userTags = [] } = useUserTags();
    const { tagsOnSong = [] } = useTagsOnSong(songId);
    const { applyTag } = useApplyTag();
    const { unapplyTag } = useUnapplyTag();
    const [createTagOpen, setCreateTagOpen] = useState(false);

    const appliedTagIds = new Set(tagsOnSong.map((tag) => tag.id));
    const songTags: EditableSongTag[] = userTags.map((tag) => ({
        ...tag,
        applied: appliedTagIds.has(tag.id),
    }));

    async function applyTagById(tagId: number) {
        await applyTag({ song_id: songId, tag_id: tagId });
    }

    async function toggleTag(tagId: number) {
        const tag = userTags.find((candidate) => candidate.id === tagId);
        if (!tag) return;

        const isApplied = tagsOnSong.some(
            (appliedTag) => appliedTag.id === tagId,
        );
        if (isApplied) await unapplyTag({ song_id: songId, tag_id: tag.id });
        else await applyTag({ song_id: songId, tag_id: tag.id });
    }

    return {
        songTags,
        toggleTag: (tagId: number) => void toggleTag(tagId),
        createTagOpen,
        openCreateTag: () => setCreateTagOpen(true),
        onCreateTagOpenChange: setCreateTagOpen,
        // A tag made from here is meant for this song, so apply it rather
        // than making the user find it in the list afterwards.
        onTagCreated: (tagId: number) => void applyTagById(tagId),
    };
}

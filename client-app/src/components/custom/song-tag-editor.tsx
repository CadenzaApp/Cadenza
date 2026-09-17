import { useState } from "react";

import {
    useApplyTag,
    useDefaultTagsOnSong,
    useSetTagValue,
    useTagsOnSong,
    useUnapplyTag,
} from "@/lib/routes/songs";
import { useUserTags } from "@/lib/routes/tags";
import { isAttributeTag, unownedDefaultTags } from "@/lib/tag-values";
import type { AppliedTag, Tag } from "@/lib/types";

export type EditableSongTag = AppliedTag & { applied: boolean };

/**
 * Tag editing for one song, independent of whether it is playing: the data
 * behind it, not the layout. Every one of the user's tags, annotated with
 * whether it is applied and its value, the song's shared default tags, the
 * toggle/value mutations, and the "New" tag dialog's open state.
 * `media-player/tags-page.tsx` (the now-playing sheet's Tags page) is the one
 * caller; it owns the page itself.
 */
export function useSongTagEditor(songId: string) {
    const { userTags = [] } = useUserTags();
    const { tagsOnSong = [] } = useTagsOnSong(songId);
    const { defaultTagsOnSong = [] } = useDefaultTagsOnSong(songId);
    const { applyTag } = useApplyTag();
    const { unapplyTag } = useUnapplyTag();
    const { setTagValue } = useSetTagValue();
    const [createTagOpen, setCreateTagOpen] = useState(false);
    // the attribute tag whose value is being asked for, if any
    const [valuePrompt, setValuePrompt] = useState<{
        tag: Tag;
        mode: "apply" | "edit";
        initialValue: string | null;
    } | null>(null);

    const appliedTagValues = new Map(
        tagsOnSong.map((tag) => [tag.id, tag.value]),
    );
    const songTags: EditableSongTag[] = userTags.map((tag) => ({
        ...tag,
        applied: appliedTagValues.has(tag.id),
        value: appliedTagValues.get(tag.id) ?? null,
    }));
    // shared, not the user's, so they are shown but never toggled here
    const defaultTags = unownedDefaultTags(defaultTagsOnSong, tagsOnSong);

    async function applyTagById(tagId: number) {
        await applyTag({ song_id: songId, tag_id: tagId });
    }

    /** Basic tags toggle on and off, attribute tags open their value editor. */
    async function selectTag(tagId: number) {
        const tag = userTags.find((candidate) => candidate.id === tagId);
        if (!tag) return;

        const appliedTag = tagsOnSong.find(
            (candidate) => candidate.id === tagId,
        );

        if (isAttributeTag(tag.type)) {
            setValuePrompt({
                tag,
                mode: appliedTag ? "edit" : "apply",
                initialValue: appliedTag?.value ?? null,
            });
            return;
        }

        if (appliedTag) await unapplyTag({ song_id: songId, tag_id: tag.id });
        else await applyTag({ song_id: songId, tag_id: tag.id });
    }

    async function handleValueSubmit(value: string | null) {
        if (!valuePrompt) return;
        const payload = { song_id: songId, tag_id: valuePrompt.tag.id, value };

        setValuePrompt(null);
        if (valuePrompt.mode === "apply") await applyTag(payload);
        else await setTagValue(payload);
    }

    async function handleValueRemove() {
        if (!valuePrompt) return;
        const tagId = valuePrompt.tag.id;
        setValuePrompt(null);
        await unapplyTag({ song_id: songId, tag_id: tagId });
    }

    return {
        songTags,
        defaultTags,
        selectTag: (tagId: number) => void selectTag(tagId),
        valuePrompt,
        onValueSubmit: (value: string | null) =>
            void handleValueSubmit(value),
        onValueRemove: () => void handleValueRemove(),
        onValueDialogClose: () => setValuePrompt(null),
        createTagOpen,
        openCreateTag: () => setCreateTagOpen(true),
        onCreateTagOpenChange: setCreateTagOpen,
        // A tag made from here is meant for this song, so apply it rather
        // than making the user find it in the list afterwards.
        onTagCreated: (tagId: number) => void applyTagById(tagId),
    };
}

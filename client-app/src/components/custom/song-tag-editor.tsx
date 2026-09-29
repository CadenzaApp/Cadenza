import { useMemo, useRef, useState } from "react";

import {
    useApplyTag,
    useDefaultTagsOnSong,
    useRemoveDefaultTag,
    useTagsOnSong,
    useUnapplyTag,
} from "@/lib/routes/songs";
import { useCreateTag, useUserTags } from "@/lib/routes/tags";
import { sortTagSelectorItems } from "@/components/custom/tag-selector/sort-tags";
import { isAttributeTag } from "@/lib/tag-values";
import type { AppliedTag, Tag } from "@/lib/types";
import { classifyError } from "@/lib/app-error";

export type EditableSongTag = AppliedTag & { chosen: boolean };

/**
 * Tag editing for one song, independent of whether it is playing: the data
 * behind it, not the layout. Every one of the user's tags, annotated with
 * whether it is applied and its value, the song's shared default tags with the
 * copy-to-my-tags they do when tapped and the removal that hides one, the
 * toggle/value mutations, and the "New" tag dialog's open state.
 * Both the now-playing Tags page and the song-options popup use this hook, so
 * editing behavior and failure handling stay independent of either layout.
 */
export function useSongTagEditor(songId: string) {
    const { userTags = [], userTagsMeta, userTagsLoading } = useUserTags();
    const { tagsOnSong = [], tagsOnSongLoading } = useTagsOnSong(songId);
    const { defaultTagsOnSong = [], defaultTagsOnSongLoading } =
        useDefaultTagsOnSong(songId);
    const { applyTag } = useApplyTag();
    const { createTag } = useCreateTag();
    const { unapplyTag } = useUnapplyTag();
    const { removeDefaultTag } = useRemoveDefaultTag();
    const [recentTags, setRecentTags] = useState<{
        songId: string;
        tags: Tag[];
    }>({ songId, tags: [] });
    const [optimisticSelections, setOptimisticSelections] = useState<{
        songId: string;
        choices: Record<
            number,
            { chosen: boolean; baseline: boolean; generation: number }
        >;
    }>({ songId, choices: {} });
    const mutationGeneration = useRef(0);
    const latestGenerationByTag = useRef(new Map<number, number>());
    const mutationChains = useRef(new Map<number, Promise<void>>());
    const [editorError, setEditorError] = useState<string | null>(null);
    // the attribute tag whose value is being asked for, if any
    const [valuePrompt, setValuePrompt] = useState<{
        tag: Tag;
        mode: "apply";
        initialValue: string | null;
    } | null>(null);

    const currentRecentTags = useMemo(
        () => (recentTags.songId === songId ? recentTags.tags : []),
        [recentTags, songId],
    );
    const allUserTags = useMemo(() => {
        const knownTagIds = new Set(userTags.map((tag) => tag.id));
        return [
            ...userTags,
            ...currentRecentTags.filter((tag) => !knownTagIds.has(tag.id)),
        ];
    }, [currentRecentTags, userTags]);
    const appliedTagValues = useMemo(
        () => new Map(tagsOnSong.map((tag) => [tag.id, tag.value])),
        [tagsOnSong],
    );
    const optimisticChoices = useMemo(
        () =>
            optimisticSelections.songId === songId
                ? optimisticSelections.choices
                : {},
        [optimisticSelections, songId],
    );
    const editableTags: EditableSongTag[] = useMemo(
        () =>
            allUserTags.map((tag) => {
                const applied = appliedTagValues.has(tag.id);
                const optimistic = optimisticChoices[tag.id];
                return {
                    ...tag,
                    chosen:
                        optimistic && optimistic.baseline === applied
                            ? optimistic.chosen
                            : applied,
                    value: appliedTagValues.get(tag.id) ?? null,
                };
            }),
        [allUserTags, appliedTagValues, optimisticChoices],
    );
    const suggestedNames = useMemo(
        () =>
            new Set(
                defaultTagsOnSong.map((tag) => tag.name.trim().toLowerCase()),
            ),
        [defaultTagsOnSong],
    );
    const defaultTags = useMemo(() => {
        const ownedNames = new Set(
            allUserTags.map((tag) => tag.name.trim().toLowerCase()),
        );
        return defaultTagsOnSong.filter(
            (tag) => !ownedNames.has(tag.name.trim().toLowerCase()),
        );
    }, [allUserTags, defaultTagsOnSong]);

    const editorLoaded =
        !userTagsLoading && !tagsOnSongLoading && !defaultTagsOnSongLoading;
    const songTags = useMemo(
        () =>
            sortTagSelectorItems(
                editableTags,
                {
                    kind: "single",
                    initiallyChosenIds: new Set(
                        tagsOnSong.map((tag) => tag.id),
                    ),
                    suggestedNames,
                },
                userTagsMeta,
            ),
        [editableTags, suggestedNames, tagsOnSong, userTagsMeta],
    );
    const recentTagIds = currentRecentTags.map((tag) => tag.id);

    function rememberRecentTag(tag: Tag) {
        setRecentTags((recent) => ({
            songId,
            tags: recent.songId === songId ? [...recent.tags, tag] : [tag],
        }));
    }

    function setOptimisticChoice(
        tagId: number,
        chosen: boolean,
        baseline: boolean,
    ): number {
        const generation = ++mutationGeneration.current;
        setOptimisticSelections((current) => ({
            songId,
            choices: {
                ...(current.songId === songId ? current.choices : {}),
                [tagId]: { chosen, baseline, generation },
            },
        }));
        return generation;
    }

    function clearOptimisticChoice(tagId: number, generation: number) {
        setOptimisticSelections((current) => {
            if (current.songId !== songId) return current;
            if (current.choices[tagId]?.generation !== generation) {
                return current;
            }
            const choices = { ...current.choices };
            delete choices[tagId];
            return { songId, choices };
        });
    }

    async function runTagMutation(
        tagId: number,
        chosen: boolean,
        baseline: boolean,
        mutation: () => Promise<unknown>,
    ) {
        setEditorError(null);
        const generation = setOptimisticChoice(tagId, chosen, baseline);
        latestGenerationByTag.current.set(tagId, generation);
        const previous = mutationChains.current.get(tagId) ?? Promise.resolve();
        const operation = previous
            .catch(() => undefined)
            .then(async () => {
                await mutation();
            });
        mutationChains.current.set(tagId, operation);

        try {
            await operation;
        } catch (error) {
            console.error(`Updating tag ${tagId} failed`, error);
            if (latestGenerationByTag.current.get(tagId) === generation) {
                setEditorError(classifyError(error).detail);
            }
        } finally {
            if (mutationChains.current.get(tagId) === operation) {
                mutationChains.current.delete(tagId);
                latestGenerationByTag.current.delete(tagId);
            }
            clearOptimisticChoice(tagId, generation);
        }
    }

    async function applyTagById(tagId: number) {
        await applyTag({ song_id: songId, tag_id: tagId });
    }

    /** Basic tags toggle on and off, attribute tags open their value editor. */
    async function selectTag(tagId: number) {
        const tag = editableTags.find((candidate) => candidate.id === tagId);
        if (!tag) return;

        const applied = appliedTagValues.has(tag.id);
        if (tag.chosen) {
            await runTagMutation(tag.id, false, applied, () =>
                unapplyTag({ song_id: songId, tag_id: tag.id }),
            );
            return;
        }

        if (isAttributeTag(tag.type)) {
            setValuePrompt({
                tag,
                mode: "apply",
                initialValue: null,
            });
            return;
        }

        await runTagMutation(tag.id, true, applied, () =>
            applyTag({ song_id: songId, tag_id: tag.id }),
        );
    }

    /**
     * A tapped default tag ends up on the song as one of the user's own: their
     * tag of that name if they already have one, otherwise a copy of the
     * default. The pill then moves from Suggested to Your Tags because the
     * suggested list excludes names the user owns.
     */
    async function adoptDefaultTag(tagId: number) {
        const defaultTag = defaultTags.find(
            (candidate) => candidate.id === tagId,
        );
        if (!defaultTag) return;

        const ownedName = defaultTag.name.trim().toLowerCase();
        const owned = allUserTags.find(
            (candidate) => candidate.name.trim().toLowerCase() === ownedName,
        );

        if (owned) {
            // an owned attribute tag asks for its value first, the same as a
            // tap anywhere else on this page
            if (isAttributeTag(owned.type)) {
                setValuePrompt({
                    tag: owned,
                    mode: "apply",
                    initialValue: null,
                });
                return;
            }
            await runTagMutation(owned.id, true, false, () =>
                applyTag({ song_id: songId, tag_id: owned.id }),
            );
            return;
        }

        let createdTagId: number | void;
        try {
            createdTagId = await createTag({
                name: defaultTag.name,
                color: defaultTag.color,
                type: defaultTag.type,
            });
        } catch (error) {
            console.error("Adopting a suggested tag failed", error);
            setEditorError(classifyError(error).detail);
            return;
        }
        if (typeof createdTagId === "number") {
            const createdTag = { ...defaultTag, id: createdTagId };
            rememberRecentTag(createdTag);
            await runTagMutation(createdTagId, true, false, () =>
                applyTagById(createdTagId),
            );
        }
    }

    /**
     * Drops one of the song's suggested tags for this user. It stays a default
     * tag on the song for everyone else, and the pill goes as soon as the
     * default tag read comes back without it. The count it leaves behind makes
     * the name harder to promote elsewhere.
     */
    async function removeDefaultTagById(tagId: number) {
        await removeDefaultTag({ song_id: songId, tag_id: tagId });
    }

    async function handleValueSubmit(value: string | null) {
        if (!valuePrompt) return;
        const payload = { song_id: songId, tag_id: valuePrompt.tag.id, value };

        setValuePrompt(null);
        const applied = appliedTagValues.has(valuePrompt.tag.id);
        await runTagMutation(valuePrompt.tag.id, true, applied, () =>
            applyTag(payload),
        );
    }

    async function handleValueRemove() {
        if (!valuePrompt) return;
        const tagId = valuePrompt.tag.id;
        setValuePrompt(null);
        await runTagMutation(tagId, false, true, () =>
            unapplyTag({ song_id: songId, tag_id: tagId }),
        );
    }

    return {
        songTags,
        defaultTags,
        editorLoaded,
        editorError,
        recentTagIds,
        selectTag: (tagId: number) => void selectTag(tagId),
        selectDefaultTag: (tagId: number) => void adoptDefaultTag(tagId),
        // the one callback that hands its promise back, so the menu pressing it
        // can report a removal that did not save
        removeDefaultTag: (tagId: number) => removeDefaultTagById(tagId),
        valuePrompt,
        onValueSubmit: (value: string | null) => void handleValueSubmit(value),
        onValueRemove: () => void handleValueRemove(),
        onValueDialogClose: () => setValuePrompt(null),
        // A tag made from here is meant for this song, so apply it rather
        // than making the user find it in the list afterwards.
        onTagCreated: (tag: Tag) => {
            rememberRecentTag(tag);
            void runTagMutation(tag.id, true, false, () =>
                applyTagById(tag.id),
            );
        },
    };
}

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
import { invalidateAPIData } from "@/lib/api-actions";

export type EditableSongTag = AppliedTag & { chosen: boolean };

/**
 * Tag editing for one song, independent of whether it is playing: the data
 * behind it, not the layout. Every one of the user's tags, annotated with
 * whether it is applied and its value, the song's shared default tags with the
 * copy-to-my-tags they do when tapped and the removal that hides one, the
 * toggle and value mutations.
 * Both the now-playing Tags page and the song-options popup use this hook, so
 * editing behavior and failure handling stay independent of either layout.
 */
export function useSongTagEditor(songId: string, enabled = true) {
    const {
        userTags = [],
        userTagsMeta,
        userTagsLoading,
    } = useUserTags(enabled);
    const { tagsOnSong = [], tagsOnSongLoading } = useTagsOnSong(
        songId,
        enabled,
    );
    const { defaultTagsOnSong = [], defaultTagsOnSongLoading } =
        useDefaultTagsOnSong(songId, enabled);
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
        choices: Record<number, { chosen: boolean; generation: number }>;
    }>({ songId, choices: {} });
    const mutationGeneration = useRef(0);
    const latestGenerationByTag = useRef(new Map<string, number>());
    const mutationChains = useRef(new Map<string, Promise<void>>());
    const [editorError, setEditorError] = useState<{
        songId: string;
        message: string;
    } | null>(null);
    // the attribute tag whose value is being asked for, if any
    const [valuePrompt, setValuePrompt] = useState<{
        tag: Tag;
        mode: "apply";
        initialValue: string | null;
        songId: string;
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
                    chosen: optimistic?.chosen ?? applied,
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

    // Suggested tags are intentionally not part of this gate. The editable
    // panel is useful as soon as the user's tags and applied state arrive.
    const editorLoaded = !userTagsLoading && !tagsOnSongLoading;
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

    function setOptimisticChoice(tagId: number, chosen: boolean): number {
        const generation = ++mutationGeneration.current;
        setOptimisticSelections((current) => ({
            songId,
            choices: {
                ...(current.songId === songId ? current.choices : {}),
                [tagId]: { chosen, generation },
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
        mutation: () => Promise<unknown>,
    ) {
        setEditorError(null);
        const generation = setOptimisticChoice(tagId, chosen);
        const mutationKey = `${songId}:${tagId}`;
        latestGenerationByTag.current.set(mutationKey, generation);
        const previous =
            mutationChains.current.get(mutationKey) ?? Promise.resolve();
        const operation = previous
            .catch(() => undefined)
            .then(async () => {
                await mutation();
            });
        mutationChains.current.set(mutationKey, operation);

        try {
            await operation;
            if (latestGenerationByTag.current.get(mutationKey) === generation) {
                try {
                    // Hold the optimistic choice until this one small read
                    // catches up. Other lists and queries still refresh in the
                    // background and never block the interaction.
                    await invalidateAPIData([
                        {
                            path: "/songs/local-tags",
                            params: { song_id: songId },
                        },
                    ]);
                    clearOptimisticChoice(tagId, generation);
                } catch (refreshError) {
                    // The write succeeded, so keep showing the user's choice.
                    // A later SWR refresh can reconcile the cache without
                    // falsely reporting that the edit itself failed.
                    console.error(
                        `Refreshing tags for ${songId} failed`,
                        refreshError,
                    );
                }
            }
        } catch (error) {
            console.error(`Updating tag ${tagId} failed`, error);
            if (latestGenerationByTag.current.get(mutationKey) === generation) {
                setEditorError({
                    songId,
                    message: classifyError(error).detail,
                });
                clearOptimisticChoice(tagId, generation);
            }
        } finally {
            if (mutationChains.current.get(mutationKey) === operation) {
                mutationChains.current.delete(mutationKey);
                latestGenerationByTag.current.delete(mutationKey);
            }
        }
    }

    async function applyTagById(tagId: number) {
        await applyTag({ song_id: songId, tag_id: tagId });
    }

    /** Basic tags toggle on and off, attribute tags open their value editor. */
    async function selectTag(tagId: number) {
        const tag = editableTags.find((candidate) => candidate.id === tagId);
        if (!tag) return;

        if (tag.chosen) {
            await runTagMutation(tag.id, false, () =>
                unapplyTag({ song_id: songId, tag_id: tag.id }),
            );
            return;
        }

        if (isAttributeTag(tag.type)) {
            setValuePrompt({
                tag,
                mode: "apply",
                initialValue: null,
                songId,
            });
            return;
        }

        await runTagMutation(tag.id, true, () =>
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
                    songId,
                });
                return;
            }
            await runTagMutation(owned.id, true, () =>
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
            setEditorError({
                songId,
                message: classifyError(error).detail,
            });
            return;
        }
        if (typeof createdTagId === "number") {
            const createdTag = { ...defaultTag, id: createdTagId };
            rememberRecentTag(createdTag);
            await runTagMutation(createdTagId, true, () =>
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
        if (!valuePrompt || valuePrompt.songId !== songId) return;
        const payload = { song_id: songId, tag_id: valuePrompt.tag.id, value };

        setValuePrompt(null);
        await runTagMutation(valuePrompt.tag.id, true, () => applyTag(payload));
    }

    async function handleValueRemove() {
        if (!valuePrompt || valuePrompt.songId !== songId) return;
        const tagId = valuePrompt.tag.id;
        setValuePrompt(null);
        await runTagMutation(tagId, false, () =>
            unapplyTag({ song_id: songId, tag_id: tagId }),
        );
    }

    return {
        songTags,
        defaultTags,
        editorLoaded,
        suggestedTagsLoading: defaultTagsOnSongLoading,
        editorError:
            editorError?.songId === songId ? editorError.message : null,
        recentTagIds,
        selectTag: (tagId: number) => void selectTag(tagId),
        selectDefaultTag: (tagId: number) => void adoptDefaultTag(tagId),
        // the one callback that hands its promise back, so the menu pressing it
        // can report a removal that did not save
        removeDefaultTag: (tagId: number) => removeDefaultTagById(tagId),
        valuePrompt: valuePrompt?.songId === songId ? valuePrompt : null,
        onValueSubmit: (value: string | null) => void handleValueSubmit(value),
        onValueRemove: () => void handleValueRemove(),
        onValueDialogClose: () => setValuePrompt(null),
        // A tag made from here is meant for this song, so apply it rather
        // than making the user find it in the list afterwards.
        onTagCreated: (tag: Tag) => {
            rememberRecentTag(tag);
            void runTagMutation(tag.id, true, () => applyTagById(tag.id));
        },
    };
}

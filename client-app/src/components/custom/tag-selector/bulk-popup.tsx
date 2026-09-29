import type { MusicItem } from "@apple-musickit";
import { ScrollView, useWindowDimensions } from "react-native";
import { useMemo, useState } from "react";

import { ModalPopup } from "@/components/custom/modal-popup";
import {
    sortTagSelectorItems,
    TagSelector,
    type TagSelectorItem,
} from "@/components/custom/tag-selector";
import { Text } from "@/components/ui/text";
import { classifyError } from "@/lib/app-error";
import {
    useApplyTagsToSongs,
    useRemoveTagsFromSongs,
} from "@/lib/routes/songs";
import { useCreateTag } from "@/lib/routes/tags";
import type { AppliedTag, Tag, TagMetadata } from "@/lib/types";

export type BulkTagMode = "apply" | "remove";

export function BulkTagSelectorPopup({
    mode,
    tracks,
    userTags,
    userTagsMeta,
    tagsBySong,
    defaultTagsBySong,
    loading,
    excludedTagIds = [],
    onCancel,
    onComplete,
}: {
    mode: BulkTagMode;
    tracks: readonly MusicItem[];
    userTags: readonly Tag[];
    userTagsMeta?: Readonly<Record<number, TagMetadata>>;
    tagsBySong: Readonly<Record<string, AppliedTag[]>>;
    defaultTagsBySong: Readonly<Record<string, Tag[]>>;
    loading: boolean;
    excludedTagIds?: readonly number[];
    onCancel: () => void;
    onComplete: () => void;
}) {
    const { width } = useWindowDimensions();
    const excludedIds = useMemo(
        () => new Set(excludedTagIds),
        [excludedTagIds],
    );
    const songIds = useMemo(
        () => [...new Set(tracks.map((track) => track.catalogId ?? track.id))],
        [tracks],
    );
    const initiallyPresentIds = useMemo(() => {
        const ids = new Set<number>();
        for (const songId of songIds) {
            for (const tag of tagsBySong[songId] ?? []) ids.add(tag.id);
        }
        return ids;
    }, [songIds, tagsBySong]);
    const appliedToAllIds = useMemo(() => {
        if (mode === "remove" || songIds.length === 0) return new Set<number>();

        const common = new Set(
            (tagsBySong[songIds[0]] ?? []).map((tag) => tag.id),
        );
        for (const songId of songIds.slice(1)) {
            const idsOnSong = new Set(
                (tagsBySong[songId] ?? []).map((tag) => tag.id),
            );
            for (const tagId of common) {
                if (!idsOnSong.has(tagId)) common.delete(tagId);
            }
        }
        return common;
    }, [mode, songIds, tagsBySong]);
    const initialTags = useMemo(
        () =>
            sortTagSelectorItems(
                mode === "remove"
                    ? userTags.filter(
                          (tag) =>
                              initiallyPresentIds.has(tag.id) &&
                              !excludedIds.has(tag.id),
                      )
                    : userTags.filter(
                          (tag) =>
                              !excludedIds.has(tag.id) &&
                              !appliedToAllIds.has(tag.id),
                      ),
                { kind: "multiple", initiallyPresentIds },
                userTagsMeta,
            ),
        [
            appliedToAllIds,
            excludedIds,
            initiallyPresentIds,
            mode,
            userTags,
            userTagsMeta,
        ],
    );
    const sessionKey = `${mode}:${songIds.join(",")}`;
    const [createdTags, setCreatedTags] = useState<Tag[]>([]);
    const [selection, setSelection] = useState<{
        key: string;
        overrides: Map<number, boolean>;
    }>({ key: sessionKey, overrides: new Map() });
    const chosenIds = useMemo(() => {
        const chosen = new Set<number>();
        if (selection.key !== sessionKey) return chosen;
        for (const [tagId, selected] of selection.overrides) {
            if (selected) chosen.add(tagId);
            else chosen.delete(tagId);
        }
        return chosen;
    }, [selection, sessionKey]);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const { applyTagsToSongs } = useApplyTagsToSongs();
    const { removeTagsFromSongs } = useRemoveTagsFromSongs();
    const { createTag } = useCreateTag();
    const suggestedTags = useMemo(() => {
        if (mode !== "apply" || songIds.length !== 1) return undefined;
        const ownedNames = new Set(
            [...userTags, ...createdTags].map((tag) =>
                tag.name.trim().toLowerCase(),
            ),
        );
        return (defaultTagsBySong[songIds[0]] ?? []).filter(
            (tag) => !ownedNames.has(tag.name.trim().toLowerCase()),
        );
    }, [createdTags, defaultTagsBySong, mode, songIds, userTags]);
    const selectorItems: TagSelectorItem[] = [
        ...initialTags,
        ...createdTags,
    ].map((tag) => ({
        ...tag,
        value: null,
        chosen: chosenIds.has(tag.id),
    }));

    function toggleTag(tag: TagSelectorItem) {
        setSelection((current) => {
            const overrides = new Map(
                current.key === sessionKey ? current.overrides : [],
            );
            overrides.set(tag.id, !chosenIds.has(tag.id));
            return { key: sessionKey, overrides };
        });
    }

    function handleTagCreated(tag: Tag) {
        setCreatedTags((current) => [...current, tag]);
        setSelection((current) => {
            const overrides = new Map(
                current.key === sessionKey ? current.overrides : [],
            );
            overrides.set(tag.id, true);
            return { key: sessionKey, overrides };
        });
    }

    async function chooseSuggestedTag(tag: Tag) {
        setSubmitError(null);
        try {
            const createdTagId = await createTag({
                name: tag.name,
                color: tag.color,
                type: tag.type,
            });
            if (typeof createdTagId === "number") {
                handleTagCreated({ ...tag, id: createdTagId });
            }
        } catch (error) {
            console.error("Creating a suggested tag failed:", error);
            setSubmitError(classifyError(error).detail);
        }
    }

    async function submit() {
        if (submitting || chosenIds.size === 0) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const submittedIds = [...chosenIds];
            if (submittedIds.length === 0) return;
            const payload = {
                song_ids: songIds,
                tag_ids: submittedIds,
            };
            if (mode === "apply") await applyTagsToSongs(payload);
            else await removeTagsFromSongs(payload);
            onComplete();
        } catch (error) {
            console.error(`Bulk ${mode} tags failed:`, error);
            setSubmitError(classifyError(error).detail);
            setSubmitting(false);
        }
    }

    const actionLabel = mode === "apply" ? "Apply" : "Remove";
    const pendingChoiceCount = chosenIds.size;

    return (
        <ModalPopup
            visible
            onClose={onCancel}
            variant="transparent"
            backdropClassName="px-0 py-8"
            contentStyle={{
                width: Math.min(width * 0.92, 624),
                maxWidth: 624,
                maxHeight: "80%",
                padding: 0,
            }}
        >
            <ScrollView
                contentContainerClassName="gap-4 px-4"
                showsVerticalScrollIndicator={false}
            >
                <Text className="text-xl font-semibold text-foreground">
                    {actionLabel} tags
                </Text>
                <TagSelector
                    contextKey={sessionKey}
                    tags={selectorItems}
                    suggestedTags={suggestedTags}
                    selectionMode={
                        mode === "apply" && songIds.length === 1
                            ? "single"
                            : "multiple"
                    }
                    loading={loading}
                    emptyLabel={
                        mode === "remove"
                            ? "The selected songs have no tags to remove."
                            : "You have no tags yet."
                    }
                    onToggleTag={toggleTag}
                    onChooseSuggested={(tag) => void chooseSuggestedTag(tag)}
                    onCreateTag={
                        mode === "apply" ? handleTagCreated : undefined
                    }
                    footerActions={[
                        {
                            id: "cancel",
                            label: "Cancel",
                            onPress: onCancel,
                            disabled: submitting,
                        },
                        {
                            id: mode,
                            label: submitting
                                ? `${actionLabel}ing...`
                                : actionLabel,
                            onPress: () => void submit(),
                            disabled:
                                loading ||
                                submitting ||
                                pendingChoiceCount === 0,
                            variant:
                                mode === "remove" ? "destructive" : "default",
                        },
                    ]}
                />
                {submitError ? (
                    <Text className="text-sm text-destructive">
                        {submitError}
                    </Text>
                ) : null}
            </ScrollView>
        </ModalPopup>
    );
}

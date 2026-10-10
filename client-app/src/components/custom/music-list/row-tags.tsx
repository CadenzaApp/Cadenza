import { useLayoutEffect, useState, useSyncExternalStore } from "react";

import {
    useActivityTagsOnSongs,
    useDefaultTagsOnSongs,
    useTagsOnSongs,
} from "@/lib/routes/songs";
import { useUserTags } from "@/lib/routes/tags";
import type { AppliedTag, Tag, TagMetadata } from "@/lib/types";

import {
    MusicListSelectionToolbar,
    type MusicListSelectionToolbarProps,
} from "./music-list-selection-toolbar";

/**
 * The tag reads behind a list's rows, kept out of `MusicList` itself.
 *
 * The reads live in `RowTagSource`, which pushes what they return into a
 * per-list `RowTagStore`. Each row reads only its own song out of the store,
 * so a tag response re-renders the rows it changes and nothing else: not the
 * list, not the `FlatList`, not the other rows.
 */

/** What every row's tags are read from, and which kinds the list shows. */
type RowTagSnapshot = {
    tagsBySong: Readonly<Record<string, AppliedTag[]>>;
    defaultTagsBySong: Readonly<Record<string, Tag[]>>;
    activityTagsBySong: Readonly<Record<string, AppliedTag[]>>;
    tagMetadata?: Readonly<Record<number, TagMetadata>>;
    showTags: boolean;
    showSuggested: boolean;
    showActivity: boolean;
};

/** One row's tags, as the row hands them to `MusicListItem`. */
export type RowTags = {
    tags?: readonly AppliedTag[];
    defaultTags?: readonly Tag[];
    activityTags?: readonly AppliedTag[];
    tagMetadata?: Readonly<Record<number, TagMetadata>>;
};

const EMPTY_SNAPSHOT: RowTagSnapshot = {
    tagsBySong: {},
    defaultTagsBySong: {},
    activityTagsBySong: {},
    showTags: false,
    showSuggested: false,
    showActivity: false,
};

export type RowTagStore = ReturnType<typeof createRowTagStore>;

/**
 * A store of one list's tag snapshot. `row` keeps one object per song and
 * only replaces it when that song's own tags change, which is what lets a
 * row's subscription ignore every other song's update.
 */
export function createRowTagStore() {
    let snapshot = EMPTY_SNAPSHOT;
    const rows = new Map<string, RowTags>();
    const listeners = new Set<() => void>();

    return {
        snapshot: () => snapshot,
        set(next: RowTagSnapshot) {
            snapshot = next;
            for (const listener of listeners) listener();
        },
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        row(songId: string): RowTags {
            const next: RowTags = {
                tags: snapshot.showTags
                    ? snapshot.tagsBySong[songId]
                    : undefined,
                defaultTags: snapshot.showSuggested
                    ? snapshot.defaultTagsBySong[songId]
                    : undefined,
                activityTags: snapshot.showActivity
                    ? snapshot.activityTagsBySong[songId]
                    : undefined,
                tagMetadata: snapshot.tagMetadata,
            };
            const cached = rows.get(songId);
            if (
                cached &&
                cached.tags === next.tags &&
                cached.defaultTags === next.defaultTags &&
                cached.activityTags === next.activityTags &&
                cached.tagMetadata === next.tagMetadata
            ) {
                return cached;
            }
            rows.set(songId, next);
            return next;
        },
    };
}

/** One list's store, made once per list. */
export function useRowTagStore() {
    const [store] = useState(createRowTagStore);
    return store;
}

/** One row's tags. Re-renders only when this song's tags change. */
export function useRowTags(store: RowTagStore, songId: string): RowTags {
    return useSyncExternalStore(
        store.subscribe,
        () => store.row(songId),
        () => store.row(songId),
    );
}

/**
 * Runs a list's tag reads and pushes them into `store`. Renders the selection
 * toolbar too, which needs the same reads, so a tag response re-renders this
 * and the toolbar, never `MusicList`.
 */
export function RowTagSource({
    store,
    songIds,
    loadTags,
    loadSuggested,
    showTags,
    showSuggested,
    activityTagIds,
    toolbar,
}: {
    store: RowTagStore;
    /** Every song in the list, by the id tags are applied under. */
    songIds: readonly string[];
    /** Read the user's tags and suggested tags, whether or not rows show them. */
    loadTags: boolean;
    loadSuggested: boolean;
    /** Whether rows draw the user's tags and suggested tags. */
    showTags: boolean;
    showSuggested: boolean;
    activityTagIds: readonly number[];
    /** The selection toolbar's own props, or null when not selecting. */
    toolbar: Omit<
        MusicListSelectionToolbarProps,
        | "userTags"
        | "userTagsMeta"
        | "tagsBySong"
        | "defaultTagsBySong"
        | "tagsLoading"
        | "suggestedTagsLoading"
    > | null;
}) {
    const { tagsBySong, tagsBySongLoading } = useTagsOnSongs(
        loadTags ? songIds : NO_SONG_IDS,
    );
    const { defaultTagsBySong, defaultTagsBySongLoading } =
        useDefaultTagsOnSongs(loadSuggested ? songIds : NO_SONG_IDS);
    const {
        userTags = NO_TAGS,
        userTagsMeta,
        userTagsLoading,
    } = useUserTags(loadTags);
    // only fetched when a caller asks for activity tags, which only query
    // results do
    const showActivity = activityTagIds.length > 0;
    const { activityTagsBySong } = useActivityTagsOnSongs(
        showActivity ? songIds : NO_SONG_IDS,
    );

    // before paint, so rows that just mounted draw their tags in the same
    // frame they become visible when the data is already cached
    useLayoutEffect(() => {
        store.set({
            tagsBySong,
            defaultTagsBySong,
            activityTagsBySong,
            tagMetadata: userTagsMeta,
            showTags,
            showSuggested,
            showActivity,
        });
    }, [
        activityTagsBySong,
        defaultTagsBySong,
        showActivity,
        showSuggested,
        showTags,
        store,
        tagsBySong,
        userTagsMeta,
    ]);

    return toolbar ? (
        <MusicListSelectionToolbar
            {...toolbar}
            userTags={userTags}
            userTagsMeta={userTagsMeta}
            tagsBySong={tagsBySong}
            defaultTagsBySong={defaultTagsBySong}
            tagsLoading={tagsBySongLoading || userTagsLoading}
            suggestedTagsLoading={defaultTagsBySongLoading}
        />
    ) : null;
}

const NO_SONG_IDS: readonly string[] = [];
const NO_TAGS: Tag[] = [];

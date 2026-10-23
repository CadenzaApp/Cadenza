import type { MusicItem } from "@apple-musickit";

import { withoutExplicit } from "../../../lib/explicit-filter.ts";

import type { MusicListSection } from "./types";

/** How many of an open group's songs show at first, and how many more each time. */
export const GROUP_WINDOW = 50;
/** A group shows more once a row on screen is this close to its last shown one. */
export const GROUP_WINDOW_LOOKAHEAD = 20;
/** Rows above the screen whose tags are read, for a quick scroll back up. */
export const TAG_ROWS_BEHIND = 10;
/** Rows below the screen whose tags must be read before they scroll into view. */
export const TAG_ROWS_AHEAD = 20;
/**
 * Rows below the screen read once more are needed, so the tag reads go out in
 * steps rather than one row at a time.
 */
export const TAG_ROWS_STEP = 60;

/**
 * One row of the list: a song, or in a grouped list a group's header or the
 * placeholder while its first songs load. A grouped song row knows its place
 * in the group, so the group can show more as it nears the end of what shows.
 */
export type MusicListRowItem =
    | {
          type: "track";
          track: MusicItem;
          sectionKey?: string;
          /** Where the song sits in its group, from 0. */
          indexInSection?: number;
      }
    | { type: "header"; section: MusicListSection }
    | { type: "loading"; section: MusicListSection };

/**
 * A grouped list's rows: each header, then the first `limitOf(key)` songs of
 * an open group. A group of a thousand songs stays as cheap to open, close and
 * scroll past as one of fifty; it shows more as the user scrolls through it.
 * With `hideExplicit`, a group leaves out the songs Apple rates explicit, the
 * same as a flat list does.
 */
export function sectionRows(
    sections: readonly MusicListSection[],
    limitOf: (key: string) => number,
    hideExplicit = false,
): MusicListRowItem[] {
    const rows: MusicListRowItem[] = [];
    for (const section of sections) {
        rows.push({ type: "header", section });
        if (!section.expanded) continue;
        if (section.isLoading && section.tracks.length === 0) {
            rows.push({ type: "loading", section });
            continue;
        }
        const tracks = withoutExplicit(section.tracks, hideExplicit);
        const shown = Math.min(tracks.length, limitOf(section.key));
        for (let index = 0; index < shown; index++) {
            // keyed by group too: one song can be in two groups under two ids
            rows.push({
                type: "track",
                track: tracks[index],
                sectionKey: section.key,
                indexInSection: index,
            });
        }
    }
    return rows;
}

/**
 * The groups that should show more, given rows `first` to `last` on screen:
 * any whose last shown row is within `GROUP_WINDOW_LOOKAHEAD` rows below the
 * screen, and that holds more songs than it shows. A group still loading
 * counts the songs it will have, so it is ready once they land.
 */
export function groupsToGrow(
    rows: readonly MusicListRowItem[],
    first: number,
    last: number,
    limitOf: (key: string) => number,
    countOf: (key: string) => number,
): string[] {
    const grow = new Set<string>();
    const end = Math.min(rows.length - 1, last + GROUP_WINDOW_LOOKAHEAD);
    for (let index = Math.max(0, first); index <= end; index++) {
        const row = rows[index];
        if (
            row.type !== "track" ||
            row.sectionKey === undefined ||
            row.indexInSection === undefined
        ) {
            continue;
        }
        const limit = limitOf(row.sectionKey);
        if (
            row.indexInSection >= limit - GROUP_WINDOW_LOOKAHEAD &&
            limit < countOf(row.sectionKey)
        ) {
            grow.add(row.sectionKey);
        }
    }
    return [...grow];
}

/**
 * The song ids whose tags to read next, given rows `first` to `last` on
 * screen and the ids already read, or null when every row near the screen is
 * covered. Reads a step past what is needed, so a slow scroll asks once every
 * few dozen rows rather than once a row.
 */
export function tagIdsToRead(
    rows: readonly MusicListRowItem[],
    first: number,
    last: number,
    read: ReadonlySet<string>,
    songIdOf: (track: MusicItem) => string,
): string[] | null {
    const start = Math.max(0, first - TAG_ROWS_BEHIND);
    const needed = Math.min(rows.length - 1, last + TAG_ROWS_AHEAD);
    let missing = false;
    for (let index = start; index <= needed && !missing; index++) {
        const row = rows[index];
        missing = row.type === "track" && !read.has(songIdOf(row.track));
    }
    if (!missing) return null;
    const ids: string[] = [];
    const seen = new Set<string>();
    const end = Math.min(rows.length - 1, last + TAG_ROWS_STEP);
    for (let index = start; index <= end; index++) {
        const row = rows[index];
        if (row.type !== "track") continue;
        const songId = songIdOf(row.track);
        if (read.has(songId) || seen.has(songId)) continue;
        seen.add(songId);
        ids.push(songId);
    }
    return ids;
}

/**
 * `next`, keeping each group of `previous` that is the same as its new
 * version, and `previous` itself when every group is.
 */
export function reuseSections(
    previous: readonly MusicListSection[] | null,
    next: MusicListSection[] | null,
): readonly MusicListSection[] | null {
    if (!previous || !next) return next;
    let changed = previous.length !== next.length;
    const merged = next.map((section, index) => {
        const old = previous[index];
        if (old && sameSection(old, section)) return old;
        changed = true;
        return section;
    });
    return changed ? merged : previous;
}

function sameSection(left: MusicListSection, right: MusicListSection) {
    return (
        left.key === right.key &&
        left.label === right.label &&
        left.count === right.count &&
        left.expanded === right.expanded &&
        left.isLoading === right.isLoading &&
        left.tracks.length === right.tracks.length &&
        left.tracks.every((track, index) => track === right.tracks[index])
    );
}

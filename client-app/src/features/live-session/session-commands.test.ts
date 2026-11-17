import assert from "node:assert/strict";
import test from "node:test";
import type { MusicItem } from "@apple-musickit";

import type { LiveSessionEntry } from "@/lib/routes/live-sessions";

import {
    sessionSongs,
    upcomingEntryAt,
    upcomingPosition,
} from "./session-commands.ts";

function track(fields: Partial<MusicItem>): MusicItem {
    return { id: "1", title: "Song", ...fields } as MusicItem;
}

function entry(entry_id: number): LiveSessionEntry {
    return { entry_id } as LiveSessionEntry;
}

test("library only songs are left out of a session", () => {
    const songs = sessionSongs([
        track({ id: "i.abc" }),
        track({ id: "5", catalogId: "5", songDuration: 2.5 }),
    ]);
    assert.equal(songs.length, 1);
    assert.equal(songs[0].song_id, "5");
    assert.equal(songs[0].duration_ms, 2500);
});

test("a whole-queue position maps onto the upcoming entries", () => {
    const session = { up_next: [entry(10), entry(11)] };
    // the local queue holds two played songs, then the current one at 2
    assert.equal(upcomingEntryAt(session, 2, 3)?.entry.entry_id, 10);
    assert.equal(upcomingEntryAt(session, 2, 4)?.position, 1);
    assert.equal(upcomingEntryAt(session, 2, 2), null);
    assert.equal(upcomingEntryAt(session, 2, 5), null);
});

test("a move lands among the upcoming songs, never before them", () => {
    assert.equal(upcomingPosition(2, 4), 1);
    assert.equal(upcomingPosition(2, 1), 0);
});

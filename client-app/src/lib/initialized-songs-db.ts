import * as SQLite from "expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";

import type { InitializedSongsStore } from "./song-init-job";

/** The on device mirror of the backend's `user_songs`. */
const DATABASE_NAME = "cadenza-library.db";

/**
 * How many ids go into one `IN (...)` list. SQLite caps bound parameters per
 * statement, and the library walk hands over a page at a time anyway.
 */
const SQL_PARAM_CHUNK = 100;

const CREATE_SQL = `
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS initialized_songs (
        user_id TEXT NOT NULL,
        song_id TEXT NOT NULL,
        initialized_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, song_id)
    );
    CREATE INDEX IF NOT EXISTS initialized_songs_song_id
        ON initialized_songs (song_id);
    CREATE INDEX IF NOT EXISTS initialized_songs_initialized_at
        ON initialized_songs (user_id, initialized_at);
`;

let databasePromise: Promise<SQLiteDatabase> | null = null;

/**
 * Opens the database and creates the table, once per app run. Later callers get
 * the same connection. A failed open is not cached, so the next sync retries.
 */
export function openInitializedSongsDb(): Promise<SQLiteDatabase> {
    if (databasePromise === null) {
        databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME)
            .then(async (db) => {
                await db.execAsync(CREATE_SQL);
                return db;
            })
            .catch((error) => {
                databasePromise = null;
                throw error;
            });
    }
    return databasePromise;
}

/**
 * The store the sync job writes through, bound to one account.
 *
 * Every row carries the user id it was written for. The file is per device but
 * `user_songs` is per user, so without it a second account signing in on the
 * same device would read the first account's library as its own and send the
 * difference to the server as adds and removes.
 */
export function createInitializedSongsStore(
    db: SQLiteDatabase,
    userId: string,
): InitializedSongsStore {
    return {
        async markSeen(songIds, timestamp) {
            const unknown: string[] = [];

            await db.withTransactionAsync(async () => {
                for (const chunk of chunked(songIds)) {
                    const placeholders = placeholdersFor(chunk);
                    const known = await db.getAllAsync<{ song_id: string }>(
                        `SELECT song_id FROM initialized_songs
                         WHERE user_id = ? AND song_id IN (${placeholders})`,
                        [userId, ...chunk],
                    );
                    const knownIds = new Set(known.map((row) => row.song_id));

                    // a song the server already has only needs its stamp moved
                    // forward, which is what keeps it out of the delete sweep
                    if (knownIds.size > 0) {
                        await db.runAsync(
                            `UPDATE initialized_songs SET initialized_at = ?
                             WHERE user_id = ? AND song_id IN (${placeholders})`,
                            [timestamp, userId, ...chunk],
                        );
                    }

                    for (const songId of chunk) {
                        if (!knownIds.has(songId)) unknown.push(songId);
                    }
                }
            });

            return unknown;
        },

        async getStaleSongIds(before) {
            const rows = await db.getAllAsync<{ song_id: string }>(
                `SELECT song_id FROM initialized_songs
                 WHERE user_id = ? AND initialized_at < ?`,
                [userId, before],
            );
            return rows.map((row) => row.song_id);
        },

        async recordSynced(added, removed, timestamp) {
            await db.withTransactionAsync(async () => {
                for (const chunk of chunked(added)) {
                    const values = chunk.map(() => "(?, ?, ?)").join(", ");
                    const params = chunk.flatMap((songId) => [
                        userId,
                        songId,
                        timestamp,
                    ]);
                    await db.runAsync(
                        `INSERT INTO initialized_songs
                             (user_id, song_id, initialized_at)
                         VALUES ${values}
                         ON CONFLICT (user_id, song_id)
                             DO UPDATE SET initialized_at = excluded.initialized_at`,
                        params,
                    );
                }

                for (const chunk of chunked(removed)) {
                    await db.runAsync(
                        `DELETE FROM initialized_songs
                         WHERE user_id = ? AND song_id IN (${placeholdersFor(chunk)})`,
                        [userId, ...chunk],
                    );
                }
            });
        },
    };
}

function placeholdersFor(ids: readonly string[]) {
    return ids.map(() => "?").join(", ");
}

/** Splits ids into lists short enough to bind in one statement. */
function* chunked(ids: readonly string[]) {
    for (let start = 0; start < ids.length; start += SQL_PARAM_CHUNK) {
        yield ids.slice(start, start + SQL_PARAM_CHUNK);
    }
}

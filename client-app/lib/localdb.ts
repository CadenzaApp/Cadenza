import { SQLiteDatabase } from 'expo-sqlite';


export type Tag = {
    tid: number
    name: string
}

// NOTE: https://docs.expo.dev/versions/latest/sdk/sqlite

// NOTE: the recommended expo-sqlite pattern is:
// - wrap entire app in <SqliteProvider>
// - in components, use: const db = useSQLiteContext();
// - pass that db object into these fns
//
// benefits of doing it this way: 
// - easy to use a mock db for testing
// - db guaranteed to be initialized at the right time

// NOTE: here's how u tell expo-sqlite to use this as the init fn (check _layout.tsx)
//  <SQLiteProvider databaseName="cadenzaLocalDb" onInit={initDb}>
export async function initDb(db: SQLiteDatabase) {
    await db.execAsync(`
        create table if not exists tags (
            tid integer primary key autoincrement not null,
            name text unique not null
        );
    `);
}


// NOTE: prefer runAsync over execAsync when using variables in sql
// bc it uses prepared statements

// NOTE: the returned obj of db.runAsync has "changes" and "lastInsertRowId" which could be useful
export async function addTag(db: SQLiteDatabase, name: string) {
    const res = await db.runAsync(`insert or ignore into tags (name) values (?)`, name);
    return res.changes == 0 ? null : res.lastInsertRowId;
}

export async function deleteTag(db: SQLiteDatabase, id: number) {
    await db.runAsync(`delete from tags where tid=?`, id);
}

export async function getAllTags(db: SQLiteDatabase) {
    return await db.getAllAsync<Tag>(`select * from tags`);
}

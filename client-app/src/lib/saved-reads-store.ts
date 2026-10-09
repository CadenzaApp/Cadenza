/**
 * The last good response of a backend read, kept on the device so a screen
 * can still show it offline, even right after a cold start. Only reads that
 * opt in with `useAPIData`'s `save` are kept, newest `SAVED_READS_CAP` of them.
 *
 * Every failure here is swallowed: a missing snapshot only means the screen
 * falls back to its loading or error state, as it would without this.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { touchSavedRead } from "./saved-reads";

const PREFIX = "cadenza.saved-reads.v1";
const INDEX_KEY = `${PREFIX}.index`;

function storageKey(key: string): string {
    return `${PREFIX}:${key}`;
}

/** The last saved response for `key`, or undefined when there is none. */
export async function loadSavedRead<T>(key: string): Promise<T | undefined> {
    try {
        const raw = await AsyncStorage.getItem(storageKey(key));
        return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch {
        return undefined;
    }
}

// saves run one at a time, so two at once cannot both rewrite the index from
// the same stale copy and lose a key
let pending: Promise<void> = Promise.resolve();

/** Keeps `data` as the last good response for `key`. */
export function saveRead(key: string, data: unknown): Promise<void> {
    pending = pending.then(async () => {
        try {
            const raw = await AsyncStorage.getItem(INDEX_KEY);
            const { index, evicted } = touchSavedRead(
                raw ? (JSON.parse(raw) as string[]) : [],
                key,
            );
            await AsyncStorage.multiSet([
                [storageKey(key), JSON.stringify(data)],
                [INDEX_KEY, JSON.stringify(index)],
            ]);
            if (evicted.length > 0)
                await AsyncStorage.multiRemove(evicted.map(storageKey));
        } catch {
            // a snapshot that fails to save is only a missed snapshot
        }
    });
    return pending;
}

/** Drops every saved read, for when the user signs out. */
export function clearSavedReads(): Promise<void> {
    pending = pending.then(async () => {
        try {
            const keys = await AsyncStorage.getAllKeys();
            await AsyncStorage.multiRemove(
                keys.filter((key) => key.startsWith(PREFIX)),
            );
        } catch {
            // left behind, but every key is scoped by account id anyway
        }
    });
    return pending;
}

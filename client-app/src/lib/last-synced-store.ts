/**
 * When this device last finished a complete library sync, per account. On the
 * device because the sync itself runs per device. Failures are swallowed: a
 * missing stamp only means the label says "Not synced yet".
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "cadenza.last-synced-at";

/** Epoch milliseconds of the last complete sync, or null for none. */
export async function loadLastSyncedAt(
    accountId: string,
): Promise<number | null> {
    try {
        const raw = await AsyncStorage.getItem(`${PREFIX}:${accountId}`);
        const value = raw === null ? NaN : Number(raw);
        return Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
}

export async function saveLastSyncedAt(
    accountId: string,
    syncedAt: number,
): Promise<void> {
    try {
        await AsyncStorage.setItem(`${PREFIX}:${accountId}`, String(syncedAt));
    } catch {
        // a stamp that fails to save only shows an older time
    }
}

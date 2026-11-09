/**
 * Whether an account got past the Apple Music step on this device. On the
 * device because the Apple Music connection is per device too. A failed read
 * counts as not done, which only shows the connect step again.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "cadenza.connect-step-done";

export async function loadConnectStepDone(accountId: string): Promise<boolean> {
    try {
        return (await AsyncStorage.getItem(`${PREFIX}:${accountId}`)) === "1";
    } catch {
        return false;
    }
}

export async function saveConnectStepDone(accountId: string): Promise<void> {
    try {
        await AsyncStorage.setItem(`${PREFIX}:${accountId}`, "1");
    } catch {
        // a lost flag only shows the connect step once more
    }
}

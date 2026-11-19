import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

import { useAccount } from "@/lib/account";

type PreferenceState = {
    key: string | null;
    showAllTagged: boolean;
    ready: boolean;
    saving: boolean;
    saveError: unknown;
};

const INITIAL_STATE: PreferenceState = {
    key: null,
    showAllTagged: true,
    ready: false,
    saving: false,
    saveError: undefined,
};

/** A per-account display choice stored on this device, defaulting to on. */
export function useLibrarySongPreferences() {
    const { account } = useAccount();
    const key = account
        ? `cadenza.library.songs.show-all-tagged:${account.id}`
        : null;
    // Like query builder settings, local presentation state drives the UI.
    // Storage only restores and persists it; a write must render immediately.
    const [state, setState] = useState<PreferenceState>(INITIAL_STATE);
    const current = state.key === key ? state : INITIAL_STATE;

    useEffect(() => {
        if (!key) return;
        let active = true;
        async function restore(storageKey: string) {
            let showAllTagged = true;
            try {
                showAllTagged =
                    (await AsyncStorage.getItem(storageKey)) !== "false";
            } catch (error) {
                console.error("Failed to restore Songs settings:", error);
            }
            if (active) {
                setState({
                    ...INITIAL_STATE,
                    key: storageKey,
                    showAllTagged,
                    ready: true,
                });
            }
        }
        void restore(key);
        return () => {
            active = false;
        };
    }, [key]);

    async function setShowAllTagged(value: boolean) {
        if (!key || !current.ready || current.saving) return;
        const previous = current.showAllTagged;
        setState({
            ...current,
            key,
            showAllTagged: value,
            saving: true,
            saveError: undefined,
        });
        try {
            await AsyncStorage.setItem(key, String(value));
            setState((latest) =>
                latest.key === key ? { ...latest, saving: false } : latest,
            );
        } catch (error) {
            setState((latest) =>
                latest.key === key
                    ? {
                          ...latest,
                          showAllTagged: previous,
                          saving: false,
                          saveError: error,
                      }
                    : latest,
            );
            throw error;
        }
    }

    return {
        showAllTagged: current.showAllTagged,
        ready: current.ready,
        saving: current.saving,
        saveError: current.saveError,
        setShowAllTagged,
    };
}

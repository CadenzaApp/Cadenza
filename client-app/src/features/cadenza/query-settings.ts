import { useEffect, useMemo, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
    setStoredIncludeSuggested,
    storedIncludeSuggested,
    subscribeWorkspace,
} from "./query-workspace-store";

const STORAGE_KEY = "cadenza.query-builder.settings.v1";

export type QuerySettings = {
    /**
     * Match only songs in the user's library or carrying one of their own tags,
     * not every song Cadenza knows.
     */
    libraryOrTagged: boolean;
    includeSuggested: boolean;
    showVennDiagrams: boolean;
    showUndoRedo: boolean;
    showAdvancedTags: boolean;
    showMetadataTags: boolean;
};

export const DEFAULT_QUERY_SETTINGS: QuerySettings = {
    libraryOrTagged: false,
    includeSuggested: false,
    showVennDiagrams: true,
    showUndoRedo: true,
    showAdvancedTags: true,
    showMetadataTags: false,
};

async function loadQuerySettings(): Promise<QuerySettings> {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const saved: unknown = raw ? JSON.parse(raw) : null;
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
        return DEFAULT_QUERY_SETTINGS;
    }
    const values = saved as Record<string, unknown>;
    // carried over from the old Show songs only in your library setting
    if (values.libraryOrTagged === undefined) {
        values.libraryOrTagged = values.libraryOnly;
    }
    return Object.fromEntries(
        Object.entries(DEFAULT_QUERY_SETTINGS).map(([key, fallback]) => [
            key,
            typeof values[key] === "boolean" ? values[key] : fallback,
        ]),
    ) as QuerySettings;
}

/**
 * The query builder's settings, in memory and on the device. They live
 * outside `CadenzaScreen` so the assistant can read them while the tab has
 * never been opened. Include suggested tags is held with the drafts (see
 * `query-workspace-store.ts`), since both drafts depend on it; the rest are
 * held here. A setting the user changes before the saved ones load keeps the
 * user's value.
 */
type SettingsState = {
    overrides: Partial<Omit<QuerySettings, "includeSuggested">>;
    restored: boolean;
};

let settingsState: SettingsState = { overrides: {}, restored: false };
const listeners = new Set<() => void>();
const changedDuringRestore = new Set<keyof QuerySettings>();
let restoring: Promise<void> | null = null;
let saveQueue: Promise<void> = Promise.resolve();
let lastSaved: string | null = null;

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function getSettingsState() {
    return settingsState;
}

function setSettingsState(next: SettingsState) {
    settingsState = next;
    listeners.forEach((listener) => listener());
    save();
}

/** Every setting as it stands now. Defaults until the saved ones load. */
export function currentQuerySettings(): QuerySettings {
    return {
        ...DEFAULT_QUERY_SETTINGS,
        ...settingsState.overrides,
        includeSuggested: storedIncludeSuggested(),
    };
}

/** Writes the settings once the saved ones have loaded, one write at a time. */
function save() {
    if (!settingsState.restored) return;
    const json = JSON.stringify(currentQuerySettings());
    if (json === lastSaved) return;
    lastSaved = json;
    const previous = saveQueue;
    saveQueue = (async () => {
        try {
            await previous;
            await AsyncStorage.setItem(STORAGE_KEY, json);
        } catch (error) {
            console.error("Failed to save query settings:", error);
        }
    })();
}

// Include suggested tags changes with the drafts, sometimes on its own (undo
// turns it on for a restored suggested tag), so it is saved from there too
subscribeWorkspace(save);

/** Loads the saved settings, once per app run. Resolves when they are in. */
export function restoreQuerySettings(): Promise<void> {
    restoring ??= (async () => {
        let saved: QuerySettings | null = null;
        try {
            saved = await loadQuerySettings();
        } catch (error) {
            console.error("Failed to restore query settings:", error);
        }
        if (saved && !changedDuringRestore.has("includeSuggested")) {
            setStoredIncludeSuggested(saved.includeSuggested);
        }
        const overrides = { ...settingsState.overrides };
        if (saved) {
            for (const key of Object.keys(saved) as (keyof QuerySettings)[]) {
                if (
                    key !== "includeSuggested" &&
                    !changedDuringRestore.has(key)
                ) {
                    overrides[key] = saved[key];
                }
            }
        }
        lastSaved = saved ? JSON.stringify(saved) : null;
        setSettingsState({ overrides, restored: true });
    })();
    return restoring;
}

/** Every setting, after the saved ones load. For a read outside the screen. */
export async function readQuerySettings(): Promise<QuerySettings> {
    await restoreQuerySettings();
    return currentQuerySettings();
}

/** Changes one setting. None of them is an undo step. */
export function setQuerySetting(key: keyof QuerySettings, value: boolean) {
    changedDuringRestore.add(key);
    if (key === "includeSuggested") {
        setStoredIncludeSuggested(value);
        return;
    }
    setSettingsState({
        ...settingsState,
        overrides: { ...settingsState.overrides, [key]: value },
    });
}

/**
 * The settings for a screen, with `includeSuggested` from the drafts it shows,
 * and `setSetting`. Starts loading the saved ones.
 */
export function useQuerySettings(includeSuggested: boolean) {
    const { overrides } = useSyncExternalStore(
        subscribe,
        getSettingsState,
        getSettingsState,
    );
    useEffect(() => {
        void restoreQuerySettings();
    }, []);
    const settings = useMemo(
        () => ({ ...DEFAULT_QUERY_SETTINGS, ...overrides, includeSuggested }),
        [overrides, includeSuggested],
    );
    return { settings, setSetting: setQuerySetting };
}

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
} from "react";
import type { WorkspaceAction } from "./query-workspace";
import AsyncStorage from "@react-native-async-storage/async-storage";

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

export function useQuerySettings(
    includeSuggested: boolean,
    dispatch: Dispatch<WorkspaceAction>,
) {
    const [overrides, setOverrides] = useState<Partial<QuerySettings>>({});
    const [restored, setRestored] = useState(false);
    const changedDuringRestore = useRef(new Set<keyof QuerySettings>());
    const saveQueue = useRef(Promise.resolve());
    const settings = useMemo(
        () => ({ ...DEFAULT_QUERY_SETTINGS, ...overrides, includeSuggested }),
        [overrides, includeSuggested],
    );
    useEffect(() => {
        let active = true;
        async function restore() {
            try {
                const saved = await loadQuerySettings();
                if (!active) return;
                if (!changedDuringRestore.current.has("includeSuggested")) {
                    dispatch({
                        type: "restore-settings",
                        includeSuggested: saved.includeSuggested,
                    });
                }
                setOverrides((current) => {
                    const next = { ...current };
                    for (const key of Object.keys(
                        saved,
                    ) as (keyof QuerySettings)[]) {
                        if (
                            key !== "includeSuggested" &&
                            !changedDuringRestore.current.has(key)
                        ) {
                            next[key] = saved[key];
                        }
                    }
                    return next;
                });
            } catch (error) {
                console.error("Failed to restore query settings:", error);
            } finally {
                if (active) setRestored(true);
            }
        }
        void restore();
        return () => {
            active = false;
        };
    }, [dispatch]);
    useEffect(() => {
        if (!restored) return;
        const previous = saveQueue.current;
        saveQueue.current = (async () => {
            try {
                await previous;
                await AsyncStorage.setItem(
                    STORAGE_KEY,
                    JSON.stringify(settings),
                );
            } catch (error) {
                console.error("Failed to save query settings:", error);
            }
        })();
    }, [restored, settings]);
    const setSetting = useCallback(
        (key: keyof QuerySettings, value: boolean) => {
            changedDuringRestore.current.add(key);
            if (key === "includeSuggested") {
                dispatch({
                    type: "edit",
                    update: (current) => ({
                        ...current,
                        includeSuggested: value,
                    }),
                });
            } else {
                setOverrides((current) => ({ ...current, [key]: value }));
            }
        },
        [dispatch],
    );
    return { settings, setSetting };
}

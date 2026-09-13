import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";

import {
    LIBRARY_CATEGORY_ORDER,
    parseLibraryCategory,
    type LibraryCategory,
} from "./categories";

const STORAGE_KEY = "cadenza.library.categories";

/**
 * The categories that existed before the stored value started recording its
 * own `known` list. A historical fact, so it never changes: it is what a bare
 * legacy array was choosing among.
 */
const LEGACY_KNOWN_CATEGORIES: readonly LibraryCategory[] = [
    "playlist",
    "album",
    "song",
    "tag",
];

type LibraryCategoriesValue = {
    /** Enabled categories, always in `LIBRARY_CATEGORY_ORDER`. */
    enabled: LibraryCategory[];
    isEnabled: (category: LibraryCategory) => boolean;
    toggle: (category: LibraryCategory) => void;
};

const LibraryCategoriesContext = createContext<LibraryCategoriesValue | null>(
    null,
);

export function useLibraryCategories() {
    const value = useContext(LibraryCategoriesContext);
    if (!value) {
        throw new Error(
            "useLibraryCategories requires LibraryCategoriesProvider.",
        );
    }
    return value;
}

/**
 * Which sections the library screen shows. It lives above the navigator
 * because the screen that reads it and the sheet that edits it are separate
 * routes. The choice is persisted, since a display preference that resets
 * every launch is worse than no preference at all.
 */
export function LibraryCategoriesProvider({
    children,
}: {
    children: ReactNode;
}) {
    const [selected, setSelected] = useState<Set<LibraryCategory>>(
        () => new Set(LIBRARY_CATEGORY_ORDER),
    );

    useEffect(() => {
        let cancelled = false;
        void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
            if (cancelled || stored === null) return;
            const restored = parseStoredCategories(stored);
            if (restored) setSelected(restored);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const toggle = useCallback((category: LibraryCategory) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(category)) next.delete(category);
            else next.add(category);
            void AsyncStorage.setItem(STORAGE_KEY, serializeCategories(next));
            return next;
        });
    }, []);

    const value = useMemo<LibraryCategoriesValue>(
        () => ({
            enabled: LIBRARY_CATEGORY_ORDER.filter((category) =>
                selected.has(category),
            ),
            isEnabled: (category) => selected.has(category),
            toggle,
        }),
        [selected, toggle],
    );

    return (
        <LibraryCategoriesContext.Provider value={value}>
            {children}
        </LibraryCategoriesContext.Provider>
    );
}

/** Tolerates anything in storage; a bad value just falls back to the default. */
/**
 * The stored value records both what is enabled and which categories existed
 * when it was written. A category the user was never offered cannot have been
 * deliberately turned off, so it comes back enabled rather than silently
 * missing for everyone who saved a selection before it shipped.
 */
function serializeCategories(enabled: Set<LibraryCategory>) {
    return JSON.stringify({
        enabled: [...enabled],
        known: [...LIBRARY_CATEGORY_ORDER],
    });
}

function parseStoredCategories(stored: string) {
    try {
        const parsed: unknown = JSON.parse(stored);
        // The legacy shape was a bare array, written before `known` existed.
        const isLegacy = Array.isArray(parsed);
        const raw = parsed as { enabled?: unknown; known?: unknown };
        const enabledInput = isLegacy ? parsed : raw.enabled;
        if (!Array.isArray(enabledInput)) return null;

        const enabled = new Set(readCategories(enabledInput));
        const known = new Set(
            isLegacy || !Array.isArray(raw.known)
                ? LEGACY_KNOWN_CATEGORIES
                : readCategories(raw.known),
        );
        for (const category of LIBRARY_CATEGORY_ORDER) {
            if (!known.has(category)) enabled.add(category);
        }
        return enabled;
    } catch {
        return null;
    }
}

function readCategories(entries: unknown[]) {
    return entries
        .map((entry) =>
            typeof entry === "string" ? parseLibraryCategory(entry) : undefined,
        )
        .filter((entry) => entry !== undefined);
}

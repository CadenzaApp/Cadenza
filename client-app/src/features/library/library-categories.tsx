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
            void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
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
function parseStoredCategories(stored: string) {
    try {
        const parsed: unknown = JSON.parse(stored);
        if (!Array.isArray(parsed)) return null;
        const categories = parsed
            .map((entry) =>
                typeof entry === "string"
                    ? parseLibraryCategory(entry)
                    : undefined,
            )
            .filter((entry) => entry !== undefined);
        return new Set(categories);
    } catch {
        return null;
    }
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";

const SHOW_SUGGESTED_TAGS_STORAGE_KEY =
    "cadenza.music-list.show-suggested-tags";

type MusicListPreferencesValue = {
    /** Whether suggested tags appear in song rows. Defaults to true. */
    showSuggestedTags: boolean;
    setShowSuggestedTags: (showSuggestedTags: boolean) => void;
};

const MusicListPreferencesContext =
    createContext<MusicListPreferencesValue | null>(null);

export function useMusicListPreferences() {
    const value = useContext(MusicListPreferencesContext);
    if (!value) {
        throw new Error(
            "useMusicListPreferences requires MusicListPreferencesProvider.",
        );
    }
    return value;
}

/**
 * Local presentation choices shared by every music list. Suggested tags stay
 * visible until storage is read, preserving the default-on behavior at launch.
 */
export function MusicListPreferencesProvider({
    children,
}: {
    children: ReactNode;
}) {
    const [showSuggestedTags, setShowSuggestedTagsState] = useState(true);
    const changedBeforeRestore = useRef(false);

    useEffect(() => {
        let cancelled = false;
        void AsyncStorage.getItem(SHOW_SUGGESTED_TAGS_STORAGE_KEY)
            .then((stored) => {
                if (cancelled || changedBeforeRestore.current) return;
                setShowSuggestedTagsState(stored !== "false");
            })
            .catch((error) =>
                console.error(
                    "Failed to restore music-list tag preference:",
                    error,
                ),
            );
        return () => {
            cancelled = true;
        };
    }, []);

    const setShowSuggestedTags = useCallback((next: boolean) => {
        changedBeforeRestore.current = true;
        setShowSuggestedTagsState(next);
        void AsyncStorage.setItem(
            SHOW_SUGGESTED_TAGS_STORAGE_KEY,
            String(next),
        ).catch((error) =>
            console.error("Failed to save music-list tag preference:", error),
        );
    }, []);

    const value = useMemo<MusicListPreferencesValue>(
        () => ({ showSuggestedTags, setShowSuggestedTags }),
        [showSuggestedTags, setShowSuggestedTags],
    );

    return (
        <MusicListPreferencesContext.Provider value={value}>
            {children}
        </MusicListPreferencesContext.Provider>
    );
}

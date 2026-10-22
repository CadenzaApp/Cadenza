import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

import {
    NO_ARRANGEMENT,
    parseArrangement,
    type SongArrangement,
} from "./song-arrangement";

/** The screens that remember what their songs were last sorted and grouped by. */
export type ArrangedScreen = "library" | "query-results" | "tag" | "collection";

const STORAGE_KEY_PREFIX = "cadenza.music-list.arrangement.";

/**
 * Read once per screen per launch, then held here, so opening the same kind of
 * screen again starts arranged straight away rather than after a storage read.
 */
const remembered = new Map<ArrangedScreen, SongArrangement>();

/**
 * What a kind of screen was last sorted and grouped by, kept across launches.
 * One choice per kind of screen, not per album or tag, so every playlist opens
 * the way the last one was left. `ready` is false until a cold start has read
 * storage, so a screen can wait rather than fetch twice.
 */
export function useSavedArrangement(screen: ArrangedScreen) {
    const [state, setState] = useState(() => ({
        arrangement: remembered.get(screen) ?? NO_ARRANGEMENT,
        ready: remembered.has(screen),
    }));

    useEffect(() => {
        if (remembered.has(screen)) return;
        let cancelled = false;
        void (async () => {
            let arrangement = NO_ARRANGEMENT;
            try {
                const stored = await AsyncStorage.getItem(
                    STORAGE_KEY_PREFIX + screen,
                );
                arrangement = stored
                    ? parseArrangement(stored)
                    : NO_ARRANGEMENT;
            } catch (error) {
                console.error("Failed to restore a list's sort:", error);
            }
            // a choice made while this read was out wins
            if (!remembered.has(screen)) remembered.set(screen, arrangement);
            if (!cancelled) {
                setState({
                    arrangement: remembered.get(screen) ?? arrangement,
                    ready: true,
                });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [screen]);

    const setArrangement = useCallback(
        (arrangement: SongArrangement) => {
            remembered.set(screen, arrangement);
            setState({ arrangement, ready: true });
            void AsyncStorage.setItem(
                STORAGE_KEY_PREFIX + screen,
                JSON.stringify(arrangement),
            ).catch((error) =>
                console.error("Failed to save a list's sort:", error),
            );
        },
        [screen],
    );

    return {
        arrangement: state.arrangement,
        setArrangement,
        ready: state.ready,
    };
}

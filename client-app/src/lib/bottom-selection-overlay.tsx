import {
    createContext,
    useCallback,
    useContext,
    useId,
    useLayoutEffect,
    useState,
    type ReactNode,
} from "react";

type SetSelection = (token: string, content: ReactNode | null) => void;
const SelectionContentContext = createContext<ReactNode>(null);
const SetSelectionContext = createContext<SetSelection | null>(null);

/** Keep selection updates separate from list layout and sort registrations. */
export function BottomSelectionOverlayProvider({
    children,
}: {
    children: ReactNode;
}) {
    const [entries, setEntries] = useState<ReadonlyMap<string, ReactNode>>(
        () => new Map(),
    );
    const setSelection = useCallback<SetSelection>((token, content) => {
        setEntries((current) => {
            if ((current.get(token) ?? null) === content) return current;
            const next = new Map(current);
            if (content != null) next.set(token, content);
            else next.delete(token);
            return next;
        });
    }, []);
    const content = Array.from(entries.values()).at(-1) ?? null;
    return (
        <SetSelectionContext.Provider value={setSelection}>
            <SelectionContentContext.Provider value={content}>
                {children}
            </SelectionContentContext.Provider>
        </SetSelectionContext.Provider>
    );
}

export function useRegisterBottomSelectionOverlay(content: ReactNode | null) {
    const setSelection = useContext(SetSelectionContext);
    const token = useId();
    useLayoutEffect(() => {
        setSelection?.(token, content);
        return () => setSelection?.(token, null);
    }, [setSelection, content, token]);
}

export function useBottomSelectionOverlay() {
    return useContext(SelectionContentContext);
}

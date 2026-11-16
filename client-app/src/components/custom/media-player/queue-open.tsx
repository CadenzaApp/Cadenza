import { createContext, useContext, useEffect } from "react";

/**
 * Lets the Player page tell the pager its queue is open. On Android the pager
 * then widens the sheet's scroll region over the pages, so the queue list gets
 * vertical drags instead of the sheet. See `SheetScrollRegion` in
 * `player-pager.tsx`.
 */
export const QueueOpenContext = createContext<((open: boolean) => void) | null>(
    null,
);

/** Reports `open` to the pager while the caller is mounted. */
export function useReportQueueOpen(open: boolean) {
    const report = useContext(QueueOpenContext);
    useEffect(() => {
        report?.(open);
        return () => report?.(false);
    }, [report, open]);
}

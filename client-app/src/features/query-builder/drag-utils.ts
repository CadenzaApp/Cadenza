export type DropRect = { x: number; y: number; width: number; height: number };

export function intersectDropRects(a: DropRect, b: DropRect): DropRect | null {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const width = Math.min(a.x + a.width, b.x + b.width) - x;
    const height = Math.min(a.y + a.height, b.y + b.height) - y;
    return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** Translate cached content geometry as the sheet or its scroller moves. */
export function movedDropRect(
    rect: DropRect,
    scrollDelta: number,
    translationDelta: number,
): DropRect {
    return { ...rect, y: rect.y - scrollDelta + translationDelta };
}

/** Only eligible, visible rectangles participate in priority selection. */
export function pickDropZone<T>(
    entries: readonly {
        key: string;
        rect: DropRect;
        target: T;
        priority: number;
    }[],
    x: number,
    y: number,
    accepts: (target: T) => boolean,
) {
    let best: (typeof entries)[number] | undefined;
    for (const entry of entries) {
        const r = entry.rect;
        if (
            !accepts(entry.target) ||
            r.width <= 0 ||
            r.height <= 0 ||
            x < r.x ||
            x > r.x + r.width ||
            y < r.y ||
            y > r.y + r.height
        )
            continue;
        if (
            !best ||
            entry.priority > best.priority ||
            (entry.priority === best.priority &&
                r.width * r.height < best.rect.width * best.rect.height)
        )
            best = entry;
    }
    return best;
}

/** A release can await pickup measurements, but never outlive a newer drag. */
export class DragMeasurementSession<T> {
    private version = 0;
    private pending: Promise<T> | null = null;
    begin(measure: () => Promise<T>) {
        const version = ++this.version;
        this.pending = measure();
        return version;
    }
    isCurrent(version: number) {
        return version === this.version;
    }
    async ready(version: number): Promise<T | null> {
        if (!this.isCurrent(version)) return null;
        const result = await this.pending;
        return version === this.version ? result : null;
    }
    cancel() {
        this.version++;
        this.pending = null;
    }
}

/** A disappearing native target cannot hold the release transaction open. */
export function measureDropRect(
    view: {
        measureInWindow: (
            callback: (
                x: number,
                y: number,
                width: number,
                height: number,
            ) => void,
        ) => void;
    } | null,
    timeoutMs = 250,
): Promise<DropRect | null> {
    return new Promise((resolve) => {
        if (!view) {
            resolve(null);
            return;
        }
        const timer = setTimeout(() => resolve(null), timeoutMs);
        try {
            view.measureInWindow((x, y, width, height) => {
                clearTimeout(timer);
                resolve(
                    width > 0 && height > 0 ? { x, y, width, height } : null,
                );
            });
        } catch {
            clearTimeout(timer);
            resolve(null);
        }
    });
}

/** Notify only the targets whose highlighted state changed. */
export function createDragHoverStore() {
    let hovered: string | null = null;
    const listeners = new Map<string, Set<() => void>>();
    return {
        isHovered: (key: string) => hovered === key,
        subscribe(key: string, listener: () => void) {
            const group = listeners.get(key) ?? new Set();
            group.add(listener);
            listeners.set(key, group);
            return () => {
                group.delete(listener);
                if (!group.size) listeners.delete(key);
            };
        },
        set(key: string | null) {
            if (key === hovered) return;
            const previous = hovered;
            hovered = key;
            if (previous)
                listeners.get(previous)?.forEach((notify) => notify());
            if (key) listeners.get(key)?.forEach((notify) => notify());
        },
    };
}

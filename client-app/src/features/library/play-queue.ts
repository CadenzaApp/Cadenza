/**
 * Building one play queue out of several lists, like every album shown or every
 * saved query. Pure, so `play-queue.test.ts` runs it under `node --test`.
 */

/**
 * `read` for each value, at most `limit` at a time, with the answers in the
 * order of `values` whatever order they land in.
 */
export async function mapInOrder<Value, Result>(
    values: readonly Value[],
    limit: number,
    read: (value: Value) => Promise<Result>,
): Promise<Result[]> {
    const results = new Array<Result>(values.length);
    let next = 0;
    async function worker() {
        while (next < values.length) {
            const index = next;
            next += 1;
            results[index] = await read(values[index]);
        }
    }
    const workers = Math.max(1, Math.min(limit, values.length));
    await Promise.all(Array.from({ length: workers }, worker));
    return results;
}

/**
 * The lists one after another, each item once, kept where it first shows up.
 * `keyOf` says what makes two items the same.
 */
export function concatUnique<Item>(
    lists: readonly (readonly Item[])[],
    keyOf: (item: Item) => string,
): Item[] {
    const seen = new Set<string>();
    const queue: Item[] = [];
    for (const list of lists) {
        for (const item of list) {
            const key = keyOf(item);
            if (seen.has(key)) continue;
            seen.add(key);
            queue.push(item);
        }
    }
    return queue;
}

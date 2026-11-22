import assert from "node:assert/strict";
import test from "node:test";
import { feedCanAdvance } from "./feed-pagination.ts";
const page = (start: number, count = 10) => ({
    feed: Array.from({ length: count }, (_, i) => ({ post_id: start + i })),
});
test("stops on missing, empty, short, or repeated pages", () => {
    assert.equal(feedCanAdvance(undefined), false);
    assert.equal(feedCanAdvance([]), false);
    assert.equal(feedCanAdvance([page(0, 0)]), false);
    assert.equal(feedCanAdvance([page(0, 9)]), false);
    assert.equal(feedCanAdvance([page(0), page(0)]), false);
    assert.equal(feedCanAdvance([page(10), page(0), page(10)]), false);
});
test("stops when caught-up responses repeat fresh posts", () => {
    assert.equal(feedCanAdvance([page(0)], page(0).feed), false);
    assert.equal(
        feedCanAdvance(
            [page(0), page(10)],
            [...page(0).feed, ...page(10).feed],
        ),
        false,
    );
});
test("allows full pages that add new posts, including partial overlap", () => {
    assert.equal(feedCanAdvance([page(0)]), true);
    assert.equal(feedCanAdvance([page(0), page(5)]), true);
    assert.equal(feedCanAdvance([page(5)], page(0).feed), true);
});

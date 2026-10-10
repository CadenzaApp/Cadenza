import assert from "node:assert/strict";
import test from "node:test";

import {
    shouldDismissZoom,
    ZOOM_COLLAPSE_SHARE,
    zoomCloseDuration,
    zoomFrame,
    zoomProgressForScrollOffset,
} from "./zoom-dismiss-geometry.ts";

const W = 400;
const H = 800;
const TILE = { x: 20, y: 300, width: 160, height: 160 };
const ART = { x: 80, y: 100, width: 240, height: 240 };

test("the card starts as the whole screen", () => {
    const start = zoomFrame(W, H, TILE, ART, 0);
    assert.deepEqual(start.clip, { x: 0, y: 0, width: W, height: H });
    assert.equal(start.scale, 1);
    assert.equal(start.borderRadius, 52);
});

test("first the bottom collapses up to the artwork, the page untouched", () => {
    const collapsed = zoomFrame(W, H, TILE, ART, ZOOM_COLLAPSE_SHARE);
    assert.deepEqual(collapsed.clip, {
        x: 0,
        y: 0,
        width: W,
        height: ART.y + ART.height,
    });
    assert.equal(collapsed.scale, 1);
    assertApprox(collapsed.contentX, 0);
    assertApprox(collapsed.contentY, 0);
});

test("then the artwork lands exactly on its tile", () => {
    const end = zoomFrame(W, H, TILE, ART, 1);
    assertApprox(end.clip.x, TILE.x);
    assertApprox(end.clip.y, TILE.y);
    assertApprox(end.clip.width, TILE.width);
    assertApprox(end.clip.height, TILE.height);
    assertApprox(end.scale, TILE.width / ART.width);
    // the page sits so the artwork is what fills the card
    assertApprox(end.contentX, -ART.x * end.scale);
    assertApprox(end.contentY, -ART.y * end.scale);
});

test("artwork scrolled out of sight closes on the top of the page", () => {
    const gone = { ...ART, y: -400 };
    const end = zoomFrame(W, H, TILE, gone, 1);
    assertApprox(end.scale, TILE.width / W);
    assertApprox(end.contentY, 0);
    assertApprox(end.clip.height, TILE.height);
});

test("a close with nothing recorded lands on a centered square", () => {
    const end = zoomFrame(W, H, null, ART, 1);
    assertApprox(end.clip.width, 280);
    assertApprox(end.clip.height, 280);
    assertApprox(end.clip.x, 60);
    assertApprox(end.clip.y, 260);
});

test("corners ease to the tile's radius", () => {
    assertApprox(zoomFrame(W, H, TILE, ART, 1).borderRadius, 38.4);
    const row = { x: 20, y: 300, width: 56, height: 56 };
    assertApprox(zoomFrame(W, H, row, ART, 1).borderRadius, 13.44);
});

test("pull progress continues beyond the dismissal threshold", () => {
    assert.equal(zoomProgressForScrollOffset(20), 0);
    assert.equal(zoomProgressForScrollOffset(-55), 0.11);
    assert.equal(zoomProgressForScrollOffset(-110), 0.22);
    assert.equal(zoomProgressForScrollOffset(-220), 0.44);
    assert.equal(zoomProgressForScrollOffset(-1000), 0.96);

    assert.equal(shouldDismissZoom(-109), false);
    assert.equal(shouldDismissZoom(-110), true);
});

test("close duration only covers the remaining progress", () => {
    assert.equal(zoomCloseDuration(0), 280);
    assert.equal(zoomCloseDuration(0.5), 140);
    assert.equal(zoomCloseDuration(0.96), 16);
    assert.equal(zoomCloseDuration(1), 16);
});

function assertApprox(actual: number, expected: number) {
    assert.ok(
        Math.abs(actual - expected) < 1e-9,
        `expected ${actual} to be approximately ${expected}`,
    );
}

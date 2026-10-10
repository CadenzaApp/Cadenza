import assert from "node:assert/strict";
import test from "node:test";

import {
    shouldDismissZoom,
    ZOOM_PAGE_FADE_SHARE,
    zoomCloseDuration,
    zoomFrame,
    zoomPageOpacity,
    zoomProgressForScrollOffset,
} from "./zoom-dismiss-geometry.ts";

const W = 400;
const H = 800;
const TILE = { x: 20, y: 300, width: 160, height: 160 };
const ART = { x: 80, y: 100, width: 240, height: 240 };

test("the card starts as the whole screen", () => {
    const start = zoomFrame(W, H, TILE, ART, 0);
    assert.equal(start.scale, 1);
    assertApprox(start.translateX, 0);
    assertApprox(start.translateY, 0);
    assert.equal(start.visibleRadius, 52);
});

test("the artwork on the page lands exactly on its tile", () => {
    const end = zoomFrame(W, H, TILE, ART, 1);
    assertApprox(end.scale, TILE.width / ART.width);
    // where the artwork's corners end up on screen
    assertApprox(ART.x * end.scale + end.translateX, TILE.x);
    assertApprox(ART.y * end.scale + end.translateY, TILE.y);
    assertApprox(ART.width * end.scale, TILE.width);
});

test("artwork scrolled out of sight closes on the top of the page", () => {
    const end = zoomFrame(W, H, TILE, { ...ART, y: -400 }, 1);
    assertApprox(end.scale, TILE.width / W);
    assertApprox(end.translateY, TILE.y);
});

test("a close with nothing recorded lands on a centered square", () => {
    const end = zoomFrame(W, H, null, ART, 1);
    assertApprox(ART.width * end.scale, 280);
    assertApprox(ART.x * end.scale + end.translateX, 60);
    assertApprox(ART.y * end.scale + end.translateY, 260);
});

test("corners ease to the tile's radius and survive the scale", () => {
    const end = zoomFrame(W, H, TILE, ART, 1);
    assertApprox(end.visibleRadius, 38.4);
    assertApprox(end.borderRadius * end.scale, 38.4);
    const row = { x: 20, y: 300, width: 56, height: 56 };
    assertApprox(zoomFrame(W, H, row, ART, 1).visibleRadius, 13.44);
});

test("most of the shrink happens early, while the page fades", () => {
    const end = zoomFrame(W, H, TILE, ART, 1);
    const early = zoomFrame(W, H, TILE, ART, ZOOM_PAGE_FADE_SHARE);
    const shrunk = (1 - early.scale) / (1 - end.scale);
    assert.ok(
        shrunk > 0.5,
        `only ${shrunk} of the shrink by the end of the fade`,
    );
});

test("the page fades out early, leaving the artwork", () => {
    assert.equal(zoomPageOpacity(0), 1);
    assertApprox(zoomPageOpacity(ZOOM_PAGE_FADE_SHARE / 2), 0.5);
    assert.equal(zoomPageOpacity(ZOOM_PAGE_FADE_SHARE), 0);
    assert.equal(zoomPageOpacity(1), 0);
});

test("pull progress continues beyond the dismissal threshold", () => {
    assert.equal(zoomProgressForScrollOffset(20), 0);
    assertApprox(zoomProgressForScrollOffset(-50), 0.15);
    assertApprox(zoomProgressForScrollOffset(-100), 0.3);
    assertApprox(zoomProgressForScrollOffset(-200), 0.6);
    assert.equal(zoomProgressForScrollOffset(-1000), 0.96);

    assert.equal(shouldDismissZoom(-69), false);
    assert.equal(shouldDismissZoom(-70), true);
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

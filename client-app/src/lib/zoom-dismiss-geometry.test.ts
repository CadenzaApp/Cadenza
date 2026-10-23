import assert from "node:assert/strict";
import test from "node:test";

import {
    shouldDismissZoom,
    ZOOM_PAGE_FADE_SHARE,
    zoomCloseDuration,
    zoomFrame,
    zoomOpenFrame,
    zoomSourceFromSheet,
    zoomPointFrame,
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

test("the open grows the whole page from the tile, top-left on its corner", () => {
    const start = zoomOpenFrame(W, H, TILE, 1);
    assertApprox(start.translateX, TILE.x);
    assertApprox(start.translateY, TILE.y);
    assertApprox(W * start.scale, TILE.width);
    const full = zoomOpenFrame(W, H, TILE, 0);
    assert.equal(full.scale, 1);
    assertApprox(full.translateX, 0);
    assertApprox(full.translateY, 0);
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
    assert.equal(zoomCloseDuration(0), 350);
    assert.equal(zoomCloseDuration(0.5), 175);
    assert.equal(zoomCloseDuration(0.96), 16);
    assert.equal(zoomCloseDuration(1), 16);
});

test("a label-anchored card expands and dismisses around the measured artist name center", () => {
    const label = { x: 24, y: 540, width: 173, height: 28 };
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        const frame = zoomPointFrame(W, H, label, p);
        const centerX = frame.translateX + (W * frame.scale) / 2;
        const centerY = frame.translateY + (H * frame.scale) / 2;
        assertApprox(
            centerX,
            (W / 2) * (1 - p) + (label.x + label.width / 2) * p,
        );
        assertApprox(
            centerY,
            (H / 2) * (1 - p) + (label.y + label.height / 2) * p,
        );
    }
    const expanded = zoomPointFrame(W, H, label, 0);
    assert.equal(expanded.scale, 1);
    assert.equal(expanded.translateX, 0);
    assert.equal(expanded.translateY, 0);
});

test("label anchor has a stable centered fallback and bounds its minimized size", () => {
    const frame = zoomPointFrame(W, H, null, 1);
    assertApprox(frame.translateX + (W * frame.scale) / 2, W / 2);
    assertApprox(frame.translateY + (H * frame.scale) / 2, H / 2);
    assert.ok(frame.scale <= 0.15 + 1e-9);
    assert.ok(
        zoomPointFrame(W, H, { x: 20, y: 20, width: 1, height: 1 }, 1).scale >=
            0.04,
    );
});

function assertApprox(actual: number, expected: number) {
    assert.ok(
        Math.abs(actual - expected) < 1e-9,
        `expected ${actual} to be approximately ${expected}`,
    );
}

test("closing an album expands its cover to the larger artwork in the full-screen player", () => {
    const playerArtwork = { x: 24, y: 132, width: 352, height: 352 };
    const albumArtwork = { x: 88, y: 96, width: 224, height: 224 };
    const frame = zoomFrame(W, H, playerArtwork, albumArtwork, 1);
    assert.ok(frame.scale > 1);
    assertApprox(
        albumArtwork.x * frame.scale + frame.translateX,
        playerArtwork.x,
    );
    assertApprox(
        albumArtwork.y * frame.scale + frame.translateY,
        playerArtwork.y,
    );
    assertApprox(albumArtwork.width * frame.scale, playerArtwork.width);
    assertApprox(albumArtwork.height * frame.scale, playerArtwork.height);
});

test("album return includes the actual sheet top and Now Playing header regardless of Fabric's origin", () => {
    const sheetHeight = 741;
    const headerHeight = 76;
    const artworkBodyY = 37;
    const albumArtwork = { x: 88, y: 96, width: 224, height: 224 };
    for (const reportedSheetY of [0, 59, 92]) {
        const origin = zoomSourceFromSheet(
            {
                x: 24,
                y: reportedSheetY + headerHeight + artworkBodyY,
                width: 352,
                height: 352,
            },
            { x: 0, y: reportedSheetY, width: W, height: sheetHeight },
            { width: W, height: H },
        );
        assert.equal(origin.y, H - sheetHeight + headerHeight + artworkBodyY);
        const frame = zoomFrame(W, H, origin, albumArtwork, 1);
        assertApprox(albumArtwork.x * frame.scale + frame.translateX, origin.x);
        assertApprox(albumArtwork.y * frame.scale + frame.translateY, 172);
        assertApprox(albumArtwork.width * frame.scale, 352);
    }
});

test("a smaller sheet uses its measured size and centered horizontal inset", () => {
    const origin = zoomSourceFromSheet(
        { x: 144, y: 120, width: 52, height: 52 },
        { x: 120, y: 20, width: 360, height: 600 },
        { width: W, height: H },
    );
    assert.deepEqual(origin, { x: 44, y: 300, width: 52, height: 52 });
});

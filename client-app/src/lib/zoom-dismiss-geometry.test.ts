import assert from "node:assert/strict";
import test from "node:test";

import {
    shouldDismissZoom,
    zoomCloseDuration,
    zoomGeometry,
    zoomProgressForScrollOffset,
} from "./zoom-dismiss-geometry.ts";

test("zoom geometry lands the card's top-left corner on its artwork", () => {
    const width = 400;
    const height = 800;
    const origin = { x: 20, y: 300, width: 160, height: 160 };

    const start = zoomGeometry(width, height, origin, 0);
    assert.equal(start.scale, 1);
    assertApprox(start.translateX, 0);
    assertApprox(start.translateY, 0);
    assert.equal(start.borderRadius, 52);

    const middle = zoomGeometry(width, height, origin, 0.5);
    assertApprox(renderedLeft(width, middle), origin.x * 0.5);
    assertApprox(renderedTop(height, middle), origin.y * 0.5);

    const end = zoomGeometry(width, height, origin, 1);
    assertApprox(renderedLeft(width, end), origin.x);
    assertApprox(renderedTop(height, end), origin.y);
    assertApprox(width * end.scale, origin.width);
});

test("zoom corners stay visible as the card shrinks", () => {
    const gridEnd = zoomGeometry(
        400,
        800,
        { x: 20, y: 300, width: 160, height: 160 },
        1,
    );
    assertApprox(gridEnd.visibleBorderRadius, 38.4);
    assertApprox(gridEnd.borderRadius * gridEnd.scale, 38.4);

    const rowEnd = zoomGeometry(
        400,
        800,
        { x: 20, y: 300, width: 56, height: 56 },
        1,
    );
    assertApprox(rowEnd.visibleBorderRadius, 13.44);
    assertApprox(rowEnd.borderRadius * rowEnd.scale, 13.44);
});

test("source-less zoom keeps its centered fallback target", () => {
    const end = zoomGeometry(400, 800, null, 1);

    assert.equal(end.scale, 0.7);
    assert.equal(renderedLeft(400, end), 60);
    assert.equal(renderedTop(800, end), 360);
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

function renderedLeft(
    viewportWidth: number,
    geometry: ReturnType<typeof zoomGeometry>,
) {
    return (
        (viewportWidth - viewportWidth * geometry.scale) / 2 +
        geometry.translateX
    );
}

function renderedTop(
    viewportHeight: number,
    geometry: ReturnType<typeof zoomGeometry>,
) {
    return (
        (viewportHeight - viewportHeight * geometry.scale) / 2 +
        geometry.translateY
    );
}

function assertApprox(actual: number, expected: number) {
    assert.ok(
        Math.abs(actual - expected) < 1e-9,
        `expected ${actual} to be approximately ${expected}`,
    );
}

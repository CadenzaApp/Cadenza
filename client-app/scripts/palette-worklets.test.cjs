/* global __dirname */
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const babel = require("@babel/core");

const appRoot = path.resolve(__dirname, "..");
const { code } = babel.transformFileSync(
    path.join(appRoot, "src/features/query-builder/palette-geometry.ts"),
    {
        cwd: appRoot,
        plugins: ["@babel/plugin-transform-modules-commonjs"],
    },
);
const moduleContext = { exports: {}, global: { Error } };
vm.runInNewContext(code, moduleContext);

// UI worklets run from serialized code, without the source module's globals.
function uiWorklet(name) {
    const worklet = moduleContext.exports[name];
    assert.ok(worklet.__initData?.code, `${name} must be workletized`);
    const isolated = vm.runInNewContext(`(${worklet.__initData.code})`);
    return isolated.bind({ __closure: worklet.__closure });
}

test("palette translation defaults work in the isolated UI runtime", () => {
    const translate = uiWorklet("paletteTranslation");
    assert.equal(translate(268), 182);
    assert.equal(translate(268, undefined), 182);
    assert.equal(translate(268, 500), 232);
    assert.equal(translate(500), 0);
});

test("palette height clamping defaults work in the isolated UI runtime", () => {
    const clamp = uiWorklet("clampPaletteHeight");
    assert.equal(clamp(1000, 130), 450);
    assert.equal(clamp(1000, 130, undefined), 450);
    assert.equal(clamp(0, 130), 130);
    assert.equal(clamp(200, 600), 450);
    assert.equal(clamp(1000, 130, 500), 500);
});

test("sheet translation and action position track visible height with fixed sheet dimensions", () => {
    const paletteTranslation = uiWorklet("paletteTranslation");
    const clampPaletteHeight = uiWorklet("clampPaletteHeight");
    const maximum = 450;
    for (const visible of [130, 200, 268, 350, maximum]) {
        const translation = paletteTranslation(visible, maximum);
        const sheetTop = 800 - maximum + translation;
        const actionBottom = 800 - (maximum + 12) + translation;
        assert.equal(sheetTop, 800 - visible);
        assert.equal(sheetTop - actionBottom, 12);
    }
    assert.equal(clampPaletteHeight(0, 130), 130);
    assert.equal(clampPaletteHeight(1000, 130), 450);
    assert.equal(clampPaletteHeight(200, 600), 450);
});

/* global __dirname */
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const babel = require("@babel/core");

const appRoot = path.resolve(__dirname, "..");
function compile(file, requireModule = require) {
    const { code } = babel.transformFileSync(path.join(appRoot, file), {
        cwd: appRoot,
        plugins: ["@babel/plugin-transform-modules-commonjs"],
    });
    const context = { exports: {}, global: { Error }, require: requireModule };
    vm.runInNewContext(code, context);
    return context.exports;
}
// UI worklets must also work without the source module's globals.
function isolated(worklet) {
    assert.ok(worklet.__initData?.code, "expected a serialized UI worklet");
    const closure = Object.fromEntries(
        Object.entries(worklet.__closure).map(([key, value]) => [
            key,
            value?.__initData ? isolated(value) : value,
        ]),
    );
    return vm
        .runInNewContext(`(${worklet.__initData.code})`)
        .bind({ __closure: closure });
}
function shared(value) {
    return {
        get: () => value,
        set: (next) => {
            value = next;
        },
    };
}
const geometry = compile("src/lib/zoom-dismiss-geometry.ts");
const colors = compile("src/lib/artwork-color-utils.ts");
function runtime(platform = "ios") {
    const contexts = [],
        timings = [],
        jsQueue = [];
    let recorded,
        popped = false;
    const react = {
        createContext(value) {
            const context = { value, Provider: "Provider" };
            contexts.push(context);
            return context;
        },
        useContext: (context) => context.value,
        useRef: (current) => ({ current }),
        useState: (initial) => [
            typeof initial === "function" ? initial() : initial,
            () => {},
        ],
        useCallback: (callback) => callback,
        useMemo: (callback) => callback(),
        useEffect() {},
        useLayoutEffect() {},
    };
    const jsx = (type, props) => ({ type, props });
    const animated = {
        default: { View: "AnimatedView" },
        Easing: { bezier: () => "easing" },
        useSharedValue: shared,
        makeMutable: shared,
        useAnimatedReaction() {},
        useAnimatedStyle: () => ({}),
        runOnJS: (callback) => () => jsQueue.push(callback),
        withTiming: (to, options, finish) => {
            const timing = { to, options, finish };
            timings.push(timing);
            return timing;
        },
        withSpring: (to) => ({ spring: to }),
    };
    const hooks = compile("src/lib/zoom-dismiss.tsx", (name) => {
        if (name.startsWith("@babel/runtime/")) return require(name);
        if (name === "react") return react;
        if (name.endsWith("jsx-runtime")) return { jsx, jsxs: jsx };
        if (name === "react-native")
            return {
                Platform: { OS: platform },
                View: "View",
                StyleSheet: { create: (styles) => styles },
                useWindowDimensions: () => ({ width: 400, height: 800 }),
            };
        if (name === "react-native-reanimated") return animated;
        if (name === "./zoom-dismiss-geometry") return geometry;
        if (name === "expo-router")
            return {
                useRouter: () => ({
                    canGoBack: () => true,
                    back: () => {
                        popped = true;
                    },
                }),
            };
        if (name === "@/components/ui/skeleton")
            return {
                SkeletonAnimationContext: { Provider: "SkeletonProvider" },
            };
        throw new Error(`Unexpected import: ${name}`);
    });
    contexts[0].value = {
        peekLaunch: () => null,
        beginLaunch: () => ({
            origin: {
                set: (rect) => {
                    recorded = rect;
                },
            },
        }),
    };
    return {
        hooks,
        contexts,
        timings,
        jsQueue,
        recorded: () => recorded,
        popped: () => popped,
    };
}
function animation() {
    const env = runtime();
    const controller = env.hooks.ZoomDismissScreen({ children: "page" }).props
        .value;
    const worklet = controller.finishGestureClose;
    return { ...env, close: isolated(worklet), state: worklet.__closure };
}
function measured(rect) {
    return {
        measureInWindow: (receive) =>
            receive(rect.x, rect.y, rect.width, rect.height),
    };
}

test("release schedules the remaining close immediately without waiting for JS", () => {
    const { close, state, timings, jsQueue, popped } = animation();
    state.progress.set(0.3);
    close();
    assert.equal(state.closing.get(), true);
    assert.equal(timings.length, 1);
    assert.equal(timings[0].options.duration, 245);
    assert.equal(jsQueue.length, 0);
    timings[0].finish(true);
    assert.equal(state.cardVisible.get(), 0);
    assert.equal(popped(), false);
    assert.equal(jsQueue.length, 1);
    jsQueue[0]();
    assert.equal(popped(), true);
});
test("duplicate close commands cannot restart an in-flight close", () => {
    const { close, state, timings } = animation();
    close();
    close();
    assert.equal(timings.length, 1);
    assert.equal(state.animationGeneration.get(), 1);
});
test("an interrupted animation springs back without popping or hiding the page", () => {
    const { close, state, timings, jsQueue } = animation();
    close();
    timings[0].finish(false);
    assert.equal(state.closing.get(), false);
    assert.equal(state.progress.get().spring, 0);
    assert.equal(state.cardVisible.get(), 1);
    assert.equal(jsQueue.length, 0);
});
test("a stale animation callback cannot hide a newer card", () => {
    const { close, state, timings, jsQueue } = animation();
    close();
    state.animationGeneration.set(2);
    timings[0].finish(true);
    assert.equal(state.cardVisible.get(), 1);
    assert.equal(jsQueue.length, 0);
});
test("player links capture physical sheet coordinates including the header despite an incorrect Fabric origin", () => {
    for (const sheetY of [0, 59, 92]) {
        const { hooks, contexts, recorded } = runtime();
        const scope = hooks.ZoomSheetSourceScope({ children: "player" });
        scope.props.children.props.ref.current = measured({
            x: 0,
            y: sheetY,
            width: 400,
            height: 741,
        });
        contexts[1].value = scope.props.value;
        for (const anchor of ["artwork", "point"]) {
            const source = hooks.useZoomSource(anchor);
            source.ref.current = measured({
                x: 24,
                y: sheetY + 76 + 37,
                width: 352,
                height: 352,
            });
            source.capture();
            assert.equal(recorded().x, 24);
            assert.equal(recorded().y, 172);
            assert.equal(recorded().width, 352);
        }
    }
});
test("non-sheet sources keep their window measurements", () => {
    const { hooks, recorded } = runtime("android");
    assert.equal(hooks.ZoomSheetSourceScope({ children: "player" }), "player");
    const source = hooks.useZoomSource();
    source.ref.current = measured({ x: 24, y: 172, width: 352, height: 352 });
    source.capture();
    assert.equal(recorded().y, 172);
});
test("scrolling foreground decisions run in an isolated UI runtime", () => {
    const palette = isolated(colors.contrastPalette);
    const surface = isolated(colors.surfaceColorAt);
    assert.equal(palette("#ffffff").foreground, "#000000");
    assert.equal(palette("#000000").foreground, "#ffffff");
    const stops = ["#ffffff", "#808080", "#000000"];
    assert.equal(palette(surface(stops, 1600, 80)).foreground, "#000000");
    assert.equal(palette(surface(stops, 1600, 1500)).foreground, "#ffffff");
});
test("gradient positioning stays covered during elastic scrolling in the UI runtime", () => {
    const viewport = isolated(colors.tintViewport);
    assert.equal(viewport(1600, 800, -200).offset, 0);
    assert.equal(viewport(1600, 800, 1200).offset, 800);
    assert.equal(viewport(100, 800, 0).height, 800);
    assert.equal(viewport(1200, 800, 700, 2400).height, 2400);
    assert.equal(viewport(1200, 800, 700, 2400).offset, 400);
});

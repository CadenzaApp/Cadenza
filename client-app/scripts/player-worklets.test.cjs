/* global __dirname */
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const babel = require("@babel/core");
const root = path.resolve(__dirname, "..");
const compiled = new Map();
function compile(file, requireModule = require, globals = {}) {
    if (!compiled.has(file)) {
        compiled.set(
            file,
            babel.transformFileSync(path.join(root, file), {
                cwd: root,
                caller: {
                    name: "metro",
                    platform: "ios",
                    isDev: true,
                    supportsStaticESM: true,
                    supportsReactCompiler: true,
                },
                plugins: ["@babel/plugin-transform-modules-commonjs"],
            }).code,
        );
    }
    const context = {
        exports: {},
        global: { Error },
        require: requireModule,
        ...globals,
    };
    vm.runInNewContext(compiled.get(file), context);
    return context.exports;
}
function isolated(fn) {
    if (!fn.__initData) return fn;
    const captured = fn.__closure;
    const convert = (value) => (value?.__initData ? isolated(value) : value);
    const closure = Array.isArray(captured)
        ? captured.map(convert)
        : Object.fromEntries(
              Object.entries(captured ?? {}).map(([key, value]) => [
                  key,
                  convert(value),
              ]),
          );
    return vm
        .runInNewContext(`(${fn.__initData.code})`, { global: { Error } })
        .bind({ __closure: closure });
}

const ui = isolated;
const geometry = compile("src/lib/screen-overlay-geometry.ts");
const controllerFile = "src/lib/player-presentation.tsx";
const viewFile = "src/components/custom/media-player/media-player.tsx";
const hostFile = "src/components/custom/media-player/media-player-host.tsx";
function fixture(collapsed = true) {
    const r = {
        rendering: false,
        instances: new Map(),
        queue: [],
        animations: [],
        timers: new Map(),
        commands: [],
        haptics: [],
        styles: [],
        styleInputs: [],
        focused: true,
        hidden: false,
        track: {
            activeTrack: {
                id: "song",
                catalogId: "catalog",
                title: "Song",
                artworkColor: "#aa4400",
            },
            isPlayerCollapsed: collapsed,
            isPlaying: true,
            canSkipToNext: true,
        },
        tags: [],
    };
    function slot(create) {
        const i = r.cursor++;
        return (r.current.slots[i] ??= create());
    }
    function shared(value) {
        let current = value,
            animation;
        const ref = {
            step(value) {
                current = value;
            },
            get() {
                assert.equal(
                    r.rendering,
                    false,
                    "shared value read during React render",
                );
                return current;
            },
            cancel() {
                if (animation) {
                    animation.cancelled = true;
                    animation.callback?.(false);
                    animation = null;
                }
            },
            set(next) {
                ref.cancel();
                if (next?.animation) {
                    animation = { ...next, owner: ref };
                    r.animations.push(animation);
                } else current = next;
            },
            finish() {
                if (animation) {
                    const done = animation;
                    animation = null;
                    current = done.to;
                    done.completed = true;
                    if (done.callback) ui(done.callback)(true);
                }
            },
        };
        Object.defineProperty(ref, "value", { get: ref.get, set: ref.set });
        return ref;
    }
    const changed = (a, b) =>
        !a || !b || a.length !== b.length || a.some((x, i) => x !== b[i]);
    function effect(fn, deps) {
        const saved = slot(() => ({}));
        if (changed(saved.deps, deps)) {
            saved.deps = deps;
            r.queue.push(() => {
                saved.cleanup?.();
                saved.cleanup = fn();
            });
        }
    }
    const react = {
        createContext: (value) => ({ Provider: "Provider", value }),
        useContext: (ctx) => ctx.value,
        useId: () => slot(() => `${r.key}:${r.cursor}`),
        useRef: () => slot(() => ({ current: null })),
        useState: (initial) => {
            const state = slot(() => {
                const value = {
                    value: typeof initial === "function" ? initial() : initial,
                };
                value.set = (next) => {
                    value.value =
                        typeof next === "function" ? next(value.value) : next;
                };
                return value;
            });
            return [state.value, state.set];
        },
        useMemo: (fn, deps) => {
            const saved = slot(() => ({}));
            if (changed(saved.deps, deps)) {
                saved.deps = deps;
                saved.value = fn();
            }
            return saved.value;
        },
        useCallback: (fn, deps) => react.useMemo(() => fn, deps),
        useEffect: effect,
        useLayoutEffect: effect,
    };
    const chain = () => {
        const cb = {};
        let proxy;
        proxy = new Proxy(
            {},
            {
                get: (_, key) =>
                    key === "callbacks"
                        ? cb
                        : (value) => {
                              cb[key] =
                                  typeof value === "function"
                                      ? ui(value)
                                      : value;
                              return proxy;
                          },
            },
        );
        return proxy;
    };
    const animated = {
        __esModule: true,
        default: { View: "AnimatedView" },
        useSharedValue: (value) => slot(() => shared(value)),
        useDerivedValue: (fn) => {
            const saved = slot(() => {
                const state = {};
                state.ref = { get: () => state.fn() };
                return state;
            });
            saved.fn = ui(fn);
            return saved.ref;
        },
        useAnimatedStyle: (fn) => {
            r.styleInputs.push(Object.values(fn.__closure ?? {}));
            const saved = slot(() => ({}));
            saved.fn = ui(fn);
            r.styles.push(saved.fn);
            return {};
        },
        useAnimatedReaction: (prepare, fn) => {
            const saved = slot(() => ({}));
            saved.reaction = () => {
                const value = ui(prepare)(),
                    key = JSON.stringify(value);
                if (saved.last !== key) {
                    saved.last = key;
                    ui(fn)(value);
                }
            };
        },
        withDelay: (delay, animation) => ({ ...animation, delay }),
        withSpring: (to, config, callback) => ({
            animation: "spring",
            to,
            config,
            callback,
        }),
        withTiming: (to, config, callback) => ({
            animation: "timing",
            to,
            config,
            callback,
        }),
        cancelAnimation: (ref) => ref.cancel(),
        runOnUI: (fn) => ui(fn),
        runOnJS: (fn) => fn,
        Easing: {
            cubic: (t) => t ** 3,
            out: (fn) => fn,
            inOut: (fn) => fn,
            sin: (t) => 1 - Math.cos((t * Math.PI) / 2),
        },
        interpolate: (n, input, output) => {
            let i = 0;
            while (i < input.length - 2 && n > input[i + 1]) i++;
            return (
                output[i] +
                ((n - input[i]) / (input[i + 1] - input[i])) *
                    (output[i + 1] - output[i])
            );
        },
    };
    const jsx = (type, props) => ({ type, props });
    const commands = {
        setPlayerCollapsed: (value) => {
            r.track.isPlayerCollapsed = value;
            r.commands.push(value);
        },
        togglePlayback() {},
        skipToNext() {},
    };
    function requireModule(name) {
        if (name.startsWith("@babel/runtime/")) return require(name);
        if (name === "react") return react;
        if (name === "react/compiler-runtime")
            return {
                c: (size) =>
                    slot(() =>
                        Array(size).fill(
                            Symbol.for("react.memo_cache_sentinel"),
                        ),
                    ),
            };
        if (name.endsWith("/jsx-runtime") || name.endsWith("/jsx-dev-runtime"))
            return { jsx, jsxs: jsx, jsxDEV: jsx };
        if (name === "react-native-reanimated") return animated;
        if (name === "react-native-gesture-handler")
            return {
                Gesture: {
                    Pan: chain,
                    LongPress: chain,
                    Simultaneous: (...gestures) => ({ gestures }),
                },
                GestureDetector: "GestureDetector",
            };
        if (name === "expo-haptics")
            return {
                ImpactFeedbackStyle: { Light: "light" },
                impactAsync: async (value) => r.haptics.push(value),
            };
        if (name === "react-native")
            return {
                View: "View",
                Image: "Image",
                Pressable: "Pressable",
                Platform: { OS: "ios", select: (v) => v.ios },
                StyleSheet: { absoluteFill: {} },
                useWindowDimensions: () => ({ width: 393, height: 852 }),
            };
        if (name === "react-native-safe-area-context")
            return { useSafeAreaInsets: () => ({ top: 50, bottom: 34 }) };
        if (name === "expo-router/react-navigation")
            return {
                useTheme: () => ({ colors: { text: "#ffffff" } }),
                useIsFocused: () => r.focused,
            };
        if (name === "expo-router")
            return {
                useRouter: () => ({ push: (route) => r.commands.push(route) }),
            };
        if (name === "expo-router/native-tabs")
            return {
                NativeTabs: {
                    BottomAccessory: { usePlacement: () => "regular" },
                },
            };
        if (name === "@expo/vector-icons/Ionicons") return "Icon";
        if (name === "@/lib/playback" || name === "./playback")
            return {
                usePlaybackTrackState: () => r.track,
                usePlaybackCommands: () => commands,
            };
        if (name === "@/lib/player-presentation")
            return { usePlayerPresentation: () => r.api };
        if (name.includes("screen-overlay-geometry")) return geometry;
        if (name === "@/lib/screen-overlay")
            return {
                useBottomBarsHidden: () => r.hidden,
                usePlayerHostActive: () => r.hostActive ?? r.focused,
                useShowsRootPlayerOverlay: () => false,
                useBottomRowAction: () => r.action ?? null,
            };
        if (name === "@/lib/bottom-selection-overlay")
            return { useBottomSelectionOverlay: () => null };
        if (name === "./media-player") return { MediaPlayer: "MediaPlayer" };
        if (name === "./compact") return { MediaPlayerCompact: "Compact" };
        if (name === "@/components/ui/glass-surface")
            return { GlassSurface: "Glass" };
        if (name === "@/components/ui/glass-icon-button")
            return { GlassIconButton: "GlassIconButton" };
        if (name === "react-native-screens")
            return { FullWindowOverlay: "FullWindowOverlay" };
        throw new Error(`Unexpected module ${name}`);
    }
    let timerId = 0;
    const clocks = {
        setInterval: (fn, ms) => {
            const id = ++timerId;
            r.timers.set(id, { fn, ms });
            return id;
        },
        clearInterval: (id) => r.timers.delete(id),
    };
    r.render = (file, name, args = [], key = name) => {
        r.key = key;
        r.current = r.instances.get(key) ?? { slots: [] };
        r.instances.set(key, r.current);
        r.cursor = 0;
        r.rendering = true;
        try {
            return compile(file, requireModule, clocks)[name](...args);
        } finally {
            r.rendering = false;
        }
    };
    r.component = (node, key) => {
        r.key = key;
        r.current = r.instances.get(key) ?? { slots: [] };
        r.instances.set(key, r.current);
        r.cursor = 0;
        r.rendering = true;
        try {
            return node.type(node.props);
        } finally {
            r.rendering = false;
        }
    };
    r.flush = () => {
        for (const fn of r.queue.splice(0)) fn();
    };
    r.tick = () => {
        for (const instance of r.instances.values())
            for (const item of instance.slots) item.reaction?.();
    };
    r.unmount = (key) => {
        for (const item of r.instances.get(key)?.slots ?? []) item.cleanup?.();
        r.instances.delete(key);
    };
    r.controller = () => {
        r.api = r.render(controllerFile, "PlayerPresentationProvider", [
            { children: null },
        ]).props.value;
        r.flush();
        return r.api.motion;
    };
    r.mount = (id = "tab", kind = "tabs", y = 700) => {
        const m = r.api.motion;
        ui(m.claim)(id, kind);
        ui(m.setVisible)(id, true);
        ui(m.reportFrame)(id, { x: 20, y, width: 353, height: 52 });
        r.tick();
        if (m.phase.get() === "appearing") {
            r.animations
                .findLast((a) => a.config?.duration === 100 && !a.cancelled)
                .owner.finish();
            m.progress.finish();
            r.controller();
        }
        return m;
    };
    r.controller();
    return r;
}
function pan(r, id = "tab", native = false) {
    const cb = r.api.motion.pan(native, id).callbacks;
    return {
        ...cb,
        start: () => cb.onStart(),
        update: (x, y = 0) =>
            cb.onUpdate({ translationX: x, translationY: y, velocityX: 0 }),
        end: (x, y = 0, velocityX = 0) => {
            cb.onEnd({ translationX: x, translationY: y, velocityX });
            cb.onFinalize({}, true);
        },
    };
}

test("React Compiler keeps shared-value reads out of every player render", () => {
    for (const collapsed of [false, true]) {
        const r = fixture(collapsed);
        r.mount();
        assert.doesNotThrow(() =>
            r.render(viewFile, "MediaPlayer", [
                {
                    visible: true,
                    kind: "tabs",
                    bubbleLift: r.api.motion.lift,
                    failedArtworkUrl: null,
                    onArtworkError() {},
                },
            ]),
        );
        assert.doesNotThrow(() =>
            r.render(
                "src/components/custom/media-player/native-player-accessory.tsx",
                "NativePlayerAccessory",
                [{ failedArtworkUrl: null, onArtworkError() {} }],
            ),
        );
        assert.doesNotThrow(() =>
            r.render(hostFile, "MediaPlayerFallbackOverlay", [
                { hidden: false },
            ]),
        );
    }
});
test("covered tab and detail hosts mount no player", () => {
    const r = fixture();
    r.focused = false;
    assert.equal(
        r.render(hostFile, "MediaPlayerFallbackOverlay", [{ hidden: false }]),
        null,
    );
    assert.equal(r.render(hostFile, "MediaPlayerZoomOverlay"), null);
    assert.equal(r.timers.size, 0);
});
test("stale tab gestures cannot move or re-lock an active detail drag", () => {
    const r = fixture(),
        m = r.mount();
    ui(m.unlock)();
    const old = pan(r);
    old.start();
    old.update(100, -200);
    old.end(100, -200);
    m.position.finish();
    r.tick();
    r.mount("detail", "detail", 780);
    const active = pan(r, "detail");
    active.start();
    ui(m.reportFrame)("tab", { x: 20, y: 300, width: 100, height: 52 });
    ui(m.setLift)("tab", -400);
    active.update(0, 0);
    old.onFinalize({}, false);
    old.update(-200, 100);
    r.tick();
    assert.equal(m.phase.get(), "drag");
    assert.equal(m.free.get(), true);
    assert.equal(m.home()[1], 780);
    assert.equal(m.position.get()[1], 500);
});
test("hold unlocks once, free dragging and repeated holds stay silent", () => {
    const r = fixture(),
        m = r.mount(),
        circle = m.circleGesture("tab");
    assert.equal(circle.gestures[1].callbacks.minDuration, 220);
    circle.gestures[1].callbacks.onStart();
    assert.equal(m.free.get(), true);
    assert.deepEqual(r.haptics, ["light"]);
    const p = pan(r);
    p.start();
    p.update(80, -100);
    p.end(80, -100);
    m.position.finish();
    ui(m.unlock)();
    assert.deepEqual(r.haptics, ["light"]);
});
test("locked right drag tracks the finger and settles open or closed", () => {
    for (const distance of [40, 200]) {
        const r = fixture(),
            m = r.mount(),
            p = pan(r);
        p.start();
        p.update(distance);
        assert.ok(Math.abs(m.geometry.get().width - 52 - distance) < 1e-6);
        assert.equal(m.free.get(), false);
        assert.deepEqual(r.haptics, []);
        p.end(distance);
        m.progress.finish();
        assert.equal(m.progress.get(), distance > 150 ? 0 : 1);
    }
});
test("home capture uses 1.5 free radii and locks after the spring completes", () => {
    for (const [distance, capture] of [
        [40, true],
        [42.9, true],
        [43, false],
    ]) {
        const r = fixture(),
            m = r.mount();
        ui(m.unlock)();
        m.position.set([120, 700]);
        const p = pan(r);
        p.start();
        p.end(distance - 100);
        assert.equal(m.phase.get(), capture ? "snapping" : "settling");
        if (capture) {
            assert.equal(m.free.get(), true);
            m.position.finish();
            assert.equal(m.free.get(), false);
        }
    }
});
test("post-release spring landings capture without recapturing initial following lag", () => {
    const r = fixture(),
        m = r.mount();
    ui(m.unlock)();
    const p = pan(r);
    p.start();
    p.update(100);
    p.end(100);
    r.tick();
    assert.equal(m.phase.get(), "settling");
    m.position.finish();
    r.tick();
    m.position.set([60, 700]);
    r.tick();
    assert.equal(m.phase.get(), "snapping");
    m.position.finish();
    assert.equal(m.free.get(), false);
});
test("free expansion returns vertically, pauses, then completes the morph", () => {
    const r = fixture(),
        m = r.mount();
    ui(m.unlock)();
    m.position.set([180, 120]);
    ui(m.expand)();
    const vertical = r.animations.at(-1);
    assert.deepEqual(Array.from(vertical.to), [180, 700]);
    assert.equal(vertical.config.duration, 160);
    assert.equal(m.progress.get(), 1);
    m.position.finish();
    const pause = r.animations.at(-1);
    assert.equal(pause.config.duration, 80);
    pause.owner.finish();
    assert.equal(m.phase.get(), "expanding");
    m.progress.finish();
    assert.equal(m.phase.get(), "idle");
    assert.equal(m.progress.get(), 0);
    assert.equal(m.free.get(), false);
});
test("expanded drag waits for 8 points, then survives accessory removal and tracks the finger", () => {
    const r = fixture(false),
        m = r.mount();
    r.api.reportNativeFrame({ x: 20, y: 704, width: 353, height: 48 });
    const p = pan(r, "tab:proxy", true);
    assert.equal(p.activeOffsetX, -8);
    p.onTouchesDown({ allTouches: [{ absoluteX: 100, absoluteY: 720 }] });
    p.onTouchesMove({ allTouches: [{ absoluteX: 94, absoluteY: 720 }] });
    assert.deepEqual(r.commands, []);
    assert.equal(m.nativeTakeover.get(), false);
    p.start();
    assert.deepEqual(r.commands, [true]);
    r.api.reportNativeFrame(null);
    r.controller();
    p.update(-8);
    assert.equal(m.geometry.get().width, 353);
    p.update(-68);
    assert.ok(Math.abs(m.geometry.get().width - 293) < 0.001);
    p.update(-168);
    assert.ok(Math.abs(m.geometry.get().width - 193) < 0.001);
    p.end(-168);
    m.progress.finish();
    assert.equal(m.geometry.get().width, 52);
    r.controller();
    assert.equal(m.nativeTakeover.get(), false);
});
test("cancelled native drag returns to expanded before reinserting the accessory", () => {
    const r = fixture(false),
        m = r.mount();
    r.api.reportNativeFrame({ x: 20, y: 704, width: 353, height: 48 });
    const p = pan(r, "tab:proxy", true);
    p.start();
    p.update(-60);
    p.onFinalize({}, false);
    assert.deepEqual(r.commands, [true, false]);
    assert.equal(m.phase.get(), "expanding");
    assert.equal(r.api.inFlight.get(), true);
    m.progress.finish();
    r.controller();
    assert.equal(m.nativeTakeover.get(), false);
    assert.equal(m.geometry.get().width, 353);
});
test("native handoff waits for actual motion completion", () => {
    const r = fixture(),
        m = r.mount(),
        h = fixture();
    const render = (wanted) =>
        h.render(
            controllerFile,
            "useNativePlayerHandoff",
            [wanted, r.api.inFlight],
            "handoff",
        );
    render(false);
    ui(m.expand)();
    assert.equal(render(true), false);
    h.flush();
    h.tick();
    assert.equal(render(true), false);
    m.progress.step(0.001);
    h.tick();
    assert.equal(render(true), false);
    m.progress.finish();
    h.tick();
    assert.equal(render(true), true);
});
test("changing hosts cancels old motions and rejects old layout callbacks", () => {
    const r = fixture(),
        m = r.mount();
    ui(m.unlock)();
    m.position.set([180, 100]);
    ui(m.expand)();
    r.mount("detail", "detail", 780);
    ui(m.reportFrame)("tab", { x: 20, y: 100, width: 353, height: 52 });
    assert.equal(m.phase.get(), "idle");
    assert.equal(m.home()[1], 780);
    assert.equal(m.host.get(), "detail");
});
test("navigation during expansion cannot leave an expanded player in free-drag mode", () => {
    const r = fixture(),
        m = r.mount();
    ui(m.unlock)();
    ui(m.expand)();
    m.position.finish();
    r.animations.at(-1).owner.finish();
    r.controller();
    r.mount("detail", "detail", 780);
    assert.equal(m.progress.get(), 0);
    assert.equal(m.free.get(), false);
    const p = pan(r, "detail");
    p.start();
    p.update(-100);
    assert.ok(m.progress.get() > 0);
    p.update(-200);
    p.end(-200);
    assert.deepEqual(r.commands.at(-1), true);
});

function find(node, predicate) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node))
        return node.map((child) => find(child, predicate)).find(Boolean);
    return predicate(node) ? node : find(node.props?.children, predicate);
}
test("the tucked action centers above Search and supports the Tags plus action", () => {
    const r = fixture(false),
        m = r.mount();
    r.action = {
        expanded: false,
        icon: "add",
        accessibilityLabel: "Create a new tag",
        onPress() {},
    };
    r.api.reportNativeFrame({ x: 90, y: 720, width: 218, height: 40 });
    r.controller();
    const root = r.render(hostFile, "MediaPlayerFallbackOverlay", [
        { hidden: false, nativeAccessoryActive: true },
    ]);
    const row = find(root, (node) => node.type?.name === "MediaPlayerRow");
    const node = r.component(row, "row");
    node.props.ref.current = { measureInWindow: (fn) => fn(20, 0, 353, 760) };
    node.props.onLayout();
    r.flush();
    r.tick();
    for (const animation of r.animations)
        if (!animation.cancelled && !animation.completed)
            animation.owner.finish();
    const style = r.styles.at(-1)();
    assert.equal(
        393 - 20 - 26 + style.transform[0].translateX,
        393 - 20 - 8 - 20,
    );
    assert.equal(style.transform[2].scale, 40 / 52);
    assert.equal(
        find(node, (item) => item.type === "GlassIconButton").props
            .accessibilityLabel,
        "Create a new tag",
    );
    assert.equal(m.progress.get(), 0);
});
test("temporary hiding retains its foreground host", () => {
    const r = fixture();
    r.tags = [
        { id: 1, color: "#ff0000" },
        { id: 2, color: "#0000ff" },
    ];
    const props = {
        visible: true,
        kind: "tabs",
        bubbleLift: r.api.motion.lift,
        failedArtworkUrl: null,
        onArtworkError() {},
    };
    r.render(viewFile, "MediaPlayer", [props]);
    r.flush();
    const owner = r.api.motion.host.get();
    assert.equal(r.timers.size, 0);
    r.render(viewFile, "MediaPlayer", [{ ...props, visible: false }]);
    r.flush();
    assert.equal(r.timers.size, 0);
    assert.equal(r.api.motion.host.get(), owner);
    r.unmount("MediaPlayer");
    assert.equal(r.api.motion.host.get(), null);
});
test("unsupported right swipes on native controls suppress the release tap", () => {
    const r = fixture(false);
    r.mount();
    const p = pan(r, "native", true);
    p.onTouchesDown({ allTouches: [{ absoluteX: 30, absoluteY: 700 }] });
    p.onTouchesMove({ allTouches: [{ absoluteX: 50, absoluteY: 700 }] });
    assert.equal(r.api.motion.suppressPress.get(), true);
    assert.deepEqual(r.commands, []);
});
test("free size increases ten percent and an interrupted near-home drag re-locks", () => {
    const r = fixture(),
        m = r.mount();
    ui(m.unlock)();
    r.tick();
    r.animations.findLast((a) => a.to === 1.1).owner.finish();
    assert.equal(m.geometry.get().transform[2].scale, 1.1);
    m.position.set([50, 680]);
    const p = pan(r);
    p.start();
    p.onFinalize({}, false);
    assert.equal(m.phase.get(), "snapping");
    m.position.finish();
    assert.equal(m.free.get(), false);
});

test("temporary hiding cancels an active drag and cannot wedge the controller", () => {
    const r = fixture(),
        m = r.mount();
    ui(m.unlock)();
    const p = pan(r);
    p.start();
    p.update(50, -50);
    ui(m.setVisible)("tab", false);
    assert.equal(m.phase.get(), "idle");
    p.onFinalize({}, false);
    ui(m.setVisible)("tab", true);
    const next = pan(r);
    next.start();
    assert.equal(m.phase.get(), "drag");
});

test("circle bounds and free dragging subscribe to geometry as a mapper input", () => {
    const r = fixture(),
        m = r.mount();
    r.render(viewFile, "MediaPlayer", [
        {
            visible: true,
            kind: "tabs",
            bubbleLift: m.lift,
            failedArtworkUrl: null,
            onArtworkError() {},
        },
    ]);
    assert.ok(
        r.styleInputs[1].includes(m.geometry),
        "the surface must capture shared geometry directly, not a helper worklet",
    );
    assert.equal(r.styles[1]().width, 52);
    ui(m.unlock)();
    m.position.set([120, 500]);
    assert.equal(r.styles[1]().transform[0].translateX, 100);
    assert.equal(r.styles[1]().transform[1].translateY, -200);
});

test("native insertion hides floating glass before the first native layout report", () => {
    const r = fixture(false);
    r.mount();
    assert.equal(r.api.nativePresented, false);
    const root = r.render(hostFile, "MediaPlayerFallbackOverlay", [
        { hidden: false, nativeAccessoryActive: true },
    ]);
    const row = find(root, (node) => node.type?.name === "MediaPlayerRow");
    const tree = r.component(row, "row");
    const cover = find(
        tree,
        (node) => node.props?.accessibilityElementsHidden === true,
    );
    assert.ok(
        cover,
        "floating player must transfer ownership before native onLayout",
    );
    assert.equal(cover.props.pointerEvents, "box-none");
    const floating = find(tree, (node) => node.type === "MediaPlayer");
    assert.equal(floating.props.nativePlayer, true);
    const rendered = r.render(viewFile, "MediaPlayer", [floating.props]);
    const hiddenSurface = find(
        rendered,
        (node) =>
            node.props?.pointerEvents === "none" &&
            node.props?.style?.opacity === 0,
    );
    assert.ok(
        hiddenSurface,
        "hide only the floating visuals while the independent gesture proxy stays mounted",
    );
});

test("artwork taps remove the accessory immediately and animate the floating width", () => {
    for (const native of [false, true]) {
        const r = fixture(false),
            m = r.mount();
        r.api.reportNativeFrame({ x: 20, y: 704, width: 353, height: 48 });
        ui(m.collapse)(native);
        assert.deepEqual(r.commands, [true]);
        assert.equal(m.geometry.get().width, 353);
        m.progress.step(0.5);
        assert.equal(m.geometry.get().width, (353 + 52) / 2);
        m.progress.finish();
        assert.equal(m.geometry.get().width, 52);
    }
});

test("tucked native playback rejects swipe collapse but retains tap controls", () => {
    const r = fixture(false),
        m = r.mount();
    r.api.reportNativeFrame({ x: 90, y: 780, width: 218, height: 48 });
    const p = pan(r, "tab:proxy", true);
    p.onTouchesDown({ allTouches: [{ absoluteX: 150, absoluteY: 800 }] });
    assert.equal(ui(m.canPress)(), true);
    p.start();
    p.update(-180);
    p.end(-180, 0, -900);
    assert.deepEqual(r.commands, []);
    assert.equal(m.progress.get(), 0);
    assert.equal(m.nativeTakeover.get(), false);
});

test("expanded player positioning wrappers let palette scroll touches pass through", () => {
    const r = fixture(false);
    r.mount();
    const tree = r.render(hostFile, "MediaPlayerFallbackOverlay", [
        { hidden: false, nativeAccessoryActive: true },
    ]);
    assert.equal(tree.props.pointerEvents, "box-none");
    const positioner = tree.props.children;
    assert.equal(positioner.props.style.top, 0);
    assert.equal(
        positioner.props.pointerEvents,
        "box-none",
        "full-height positioning must not intercept touches outside the player",
    );
});

test("detail player keeps full layout width when its card is measured during a zoom", () => {
    const r = fixture(false);
    const tree = r.render(viewFile, "MediaPlayer", [
        {
            visible: true,
            kind: "detail",
            bubbleLift: r.api.motion.lift,
            failedArtworkUrl: null,
            onArtworkError() {},
        },
    ]);
    r.flush();
    const anchor = find(
        tree,
        (node) => node.props?.onLayout && node.props?.ref,
    );
    anchor.props.ref.current = {
        measureInWindow: (receive) => receive(20, 700, 250, 37),
    };
    anchor.props.onLayout({
        nativeEvent: { layout: { width: 353, height: 52, x: 0, y: 0 } },
    });
    r.animations
        .findLast((a) => a.config?.duration === 100 && !a.cancelled)
        ?.owner.finish();
    r.api.motion.progress.finish();
    assert.equal(r.api.motion.geometry.get().width, 353);
});

test("full-player sheet keeps tab and detail mini-player hosts mounted while unfocused", () => {
    const r = fixture(false);
    r.focused = false;
    r.hostActive = true;
    assert.notEqual(
        r.render(hostFile, "MediaPlayerFallbackOverlay", [{ hidden: false }]),
        null,
    );
    assert.notEqual(r.render(hostFile, "MediaPlayerZoomOverlay"), null);
});

test("first playback fades a centered circle in before expanding and native handoff", () => {
    const r = fixture(false),
        m = r.mount();
    const track = r.track.activeTrack;
    r.track.activeTrack = null;
    r.controller();
    r.controller();
    r.track.activeTrack = track;
    r.controller();
    r.controller();
    assert.equal(r.api.entrancePending, true);
    assert.equal(m.geometry.get().width, 52);
    assert.equal(m.geometry.get().opacity, 0);
    assert.equal(m.geometry.get().transform[0].translateX, (353 - 52) / 2);
    assert.equal(r.api.inFlight.get(), true);
    const fade = r.animations.findLast(
        (a) => a.config?.duration === 100 && !a.cancelled,
    );
    assert.ok(fade);
    fade.owner.finish();
    assert.equal(m.geometry.get().opacity, 1);
    assert.equal(m.progress.get(), 1);
    assert.equal(
        r.animations.findLast((a) => a.animation === "spring" && !a.cancelled)
            ?.delay,
        150,
        "hold the visible circle before starting expansion",
    );
    m.progress.step(0.5);
    assert.equal(m.geometry.get().width, (353 + 52) / 2);
    r.controller();
    assert.equal(
        r.api.motion,
        m,
        "controller must stay stable across entrance renders",
    );
    assert.equal(m.progress.get(), 0.5, "render must not restart the entrance");
    assert.equal(r.api.entrancePending, true);
    m.progress.finish();
    r.controller();
    assert.equal(r.api.entrancePending, false);
    assert.equal(m.geometry.get().width, 353);
    assert.equal(m.geometry.get().transform[0].translateX, 0);
    assert.deepEqual(r.commands, []);
});
test("changing songs does not restart the entrance or expand a collapsed bubble", () => {
    const r = fixture(),
        m = r.mount();
    r.track.activeTrack = { ...r.track.activeTrack, id: "another-song" };
    r.controller();
    assert.equal(r.api.entrancePending, false);
    assert.equal(m.progress.get(), 1);
    assert.equal(m.geometry.get().opacity, 1);
});

test("native layout ignores measurements overtaken by newer layout or unmount", () => {
    const r = fixture(false);
    r.mount();
    const view = r.render(
        "src/components/custom/media-player/native-player-accessory.tsx",
        "NativePlayerAccessory",
        [{ failedArtworkUrl: null, onArtworkError() {} }],
    );
    r.flush();
    const callbacks = [];
    view.props.ref.current = {
        measureInWindow: (callback) => callbacks.push(callback),
    };
    const layout = () =>
        view.props.onLayout({
            nativeEvent: { layout: { width: 353, height: 52 } },
        });
    layout();
    layout();
    callbacks[1](20, 700, 353, 52);
    callbacks[0](20, 600, 353, 52);
    assert.equal(r.api.nativeFrame.get().y, 700);
    layout();
    r.unmount("NativePlayerAccessory");
    callbacks[2](20, 500, 353, 52);
    assert.equal(r.api.nativeFrame.get(), null);
});

/* global __dirname */
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const babel = require("@babel/core");
const root = path.resolve(__dirname, "..");
const compiled = new Map();
function ui(fn) {
    if (!fn.__initData) return fn;
    const convert = (v) => (v?.__initData ? ui(v) : v);
    const closure = Array.isArray(fn.__closure)
        ? fn.__closure.map(convert)
        : Object.fromEntries(
              Object.entries(fn.__closure ?? {}).map(([k, v]) => [
                  k,
                  convert(v),
              ]),
          );
    return vm
        .runInNewContext(`(${fn.__initData.code})`, { global: { Error } })
        .bind({ __closure: closure });
}
function fixture() {
    const commands = [],
        options = [],
        selections = [],
        instances = new Map(),
        modules = {};
    let slots, cursor;
    let selectedTab = "player";
    const effects = [];
    const slot = (create) => {
        const index = cursor++;
        return (slots[index] ??= create());
    };
    const jsx = (type, props) => ({ type, props });
    const react = {
        useState: (initial) => {
            const state = slot(() => ({
                value: typeof initial === "function" ? initial() : initial,
            }));
            return [
                state.value,
                (next) => {
                    state.value =
                        typeof next === "function" ? next(state.value) : next;
                },
            ];
        },
        useRef: (value) => slot(() => ({ current: value })),
        useMemo: (fn) => fn(),
        useCallback: (fn) => fn(),
        useEffect(effect, deps) {
            const state = slot(() => ({}));
            if (
                !state.deps ||
                deps.some((v, i) => !Object.is(v, state.deps[i]))
            ) {
                state.deps = deps;
                effects.push(effect);
            }
        },
    };
    const native = {
        Platform: { OS: "ios" },
        View: "View",
        Pressable: "Pressable",
        ScrollView: "ScrollView",
        useWindowDimensions: () => ({ width: 400, height: 800 }),
        StyleSheet: { create: (s) => s, absoluteFill: {} },
    };
    const animated = {
        __esModule: true,
        default: {
            View: "AnimatedView",
            ScrollView: "AnimatedScrollView",
            createAnimatedComponent: (value) => `Animated${value}`,
        },
        useAnimatedRef: () =>
            slot(() => ({
                current: { scrollTo: (command) => commands.push(command) },
            })),
        useSharedValue: (initial) =>
            slot(() => {
                let value = initial;
                return {
                    get: () => value,
                    set: (next) => {
                        value = next;
                    },
                    get value() {
                        return value;
                    },
                    set value(next) {
                        value = next;
                    },
                };
            }),
        useAnimatedStyle: () => ({}),
        useDerivedValue: (fn) => ({ get: ui(fn) }),
        useAnimatedProps: (fn) => ui(fn)(),
        useAnimatedScrollHandler: (fn) => fn,
        scrollTo: (_ref, x, y, animated) => commands.push({ x, y, animated }),
        runOnJS: (fn) => fn,
        LinearTransition: { duration: () => ({}) },
    };
    function load(file) {
        if (modules[file]) return modules[file];
        if (!compiled.has(file))
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
        const context = {
            exports: {},
            global: { Error },
            requestAnimationFrame: () => 0,
            cancelAnimationFrame: () => {},
            require: requireModule,
        };
        vm.runInNewContext(compiled.get(file), context);
        return (modules[file] = context.exports);
    }
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
        if (name === "react-native") return native;
        if (name === "react-native-svg")
            return { __esModule: true, default: "Svg", Path: "Path" };
        if (name === "@react-native-masked-view/masked-view")
            return { __esModule: true, default: "MaskedView" };
        if (name === "react-native-reanimated") return animated;
        if (name === "react-native-gesture-handler")
            return {
                GestureDetector: "GestureDetector",
                usePanGesture: (config) =>
                    Object.fromEntries(
                        Object.entries(config).map(([k, v]) => [
                            k,
                            typeof v === "function" ? ui(v) : v,
                        ]),
                    ),
            };
        if (name === "expo-router")
            return {
                useNavigation: () => ({ setOptions: (v) => options.push(v) }),
            };
        if (name === "expo-symbols") return { SymbolView: "SymbolView" };
        if (name === "react-native-safe-area-context")
            return { useSafeAreaInsets: () => ({ bottom: 34 }) };
        if (name.endsWith("/theme"))
            return {
                useAppTheme: () => ({
                    scheme: "dark",
                    colors: { brand: "#ff2255", mutedForeground: "#888888" },
                }),
            };
        if (name.endsWith("/utils"))
            return { cn: (...v) => v.filter(Boolean).join(" ") };
        if (name === "./player-bar")
            return load("src/components/custom/media-player/player-bar.tsx");
        if (name === "./player-bar-drag")
            return load(
                "src/components/custom/media-player/player-bar-drag.ts",
            );
        if (name === "./player-scope")
            return { usePlayerScope: () => ({ focusedSong: { id: "song" } }) };
        if (name === "./player-tabs")
            return {
                PLAYER_TABS: ["discuss", "player", "tags"],
                usePlayerTabs: () => ({
                    selectedTab,
                    selectTab: (tab) => {
                        selectedTab = tab;
                        selections.push(tab);
                    },
                }),
            };
        if (name.endsWith("/use-current-session"))
            return { useShownLiveSession: () => null };
        if (name === "./queue-open")
            return { QueueOpenContext: { Provider: "QueueOpenProvider" } };
        const names = {
            "./discuss-page": "DiscussPage",
            "./player-page": "PlayerPage",
            "./tags-page": "TagsPage",
            "@/components/ui/text": "Text",
            "@/components/ui/glass-surface": "GlassSurface",
            "@/components/custom/modal-popup": "ModalPopup",
            "@/components/ui/dialog-close-button": "DialogCloseButton",
            "@/features/live-session/LiveSessionBar": "LiveSessionBar",
        };
        if (names[name])
            return {
                [names[name]]: names[name],
                shouldShowGlassOutline: () => false,
            };
        if (name.includes("Ionicons"))
            return { __esModule: true, default: "Ionicons" };
        throw new Error(`Unexpected dependency ${name}`);
    }
    function render(component, props = {}) {
        if (!instances.has(component)) instances.set(component, []);
        slots = instances.get(component);
        cursor = 0;
        return component(props);
    }
    return {
        load,
        render,
        commands,
        options,
        selections,
        flushEffects() {
            for (const effect of effects.splice(0)) effect();
        },
    };
}
function find(node, predicate) {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) {
        for (const child of node) {
            const result = find(child, predicate);
            if (result) return result;
        }
        return null;
    }
    if (predicate(node)) return node;
    return find(node.props?.children, predicate);
}
function barFixture() {
    const f = fixture();
    const { PlayerPager } = f.load(
        "src/components/custom/media-player/player-pager.tsx",
    );
    let shell = find(
        f.render(PlayerPager),
        (n) => n.type?.name === "PlayerBarShell",
    );
    shell.props.onLayout({ nativeEvent: { layout: { width: 360 } } });
    shell = find(
        f.render(PlayerPager),
        (n) => n.type?.name === "PlayerBarShell",
    );
    const icons = find(shell, (n) => n.type?.name === "PlayerTabIcons");
    return {
        ...f,
        shell,
        icons,
        gesture: shell.props.gesture,
        rerender: () => f.render(PlayerPager),
    };
}

test("only titles needing more than two lines open the full-title popup", () => {
    const f = fixture();
    const { PlayerTrackTitle } = f.load(
        "src/components/custom/media-player/track-title.tsx",
    );
    const props = {
        title: "A long song title with every detail intact",
        compact: false,
    };
    let tree = f.render(PlayerTrackTitle, props);
    let button = find(tree, (n) => n.type === "Pressable");
    assert.equal(button.props.disabled, true);
    assert.equal(find(button, (n) => n.type === "Text").props.numberOfLines, 2);
    button.props.onLayout({ nativeEvent: { layout: { width: 180 } } });
    tree = f.render(PlayerTrackTitle, props);
    find(tree, (n) => !!n.props?.onTextLayout).props.onTextLayout({
        nativeEvent: { lines: [{}, {}, {}] },
    });
    tree = f.render(PlayerTrackTitle, props);
    button = find(tree, (n) => n.type === "Pressable");
    assert.equal(button.props.disabled, false);
    button.props.onPress();
    tree = f.render(PlayerTrackTitle, props);
    const popup = find(tree, (n) => n.type === "ModalPopup");
    assert.equal(popup.props.visible, true);
    assert.equal(
        find(popup, (n) => n.type === "Text").props.children,
        props.title,
    );
    popup.props.onClose();
    find(tree, (n) => !!n.props?.onTextLayout).props.onTextLayout({
        nativeEvent: { lines: [{}, {}] },
    });
    tree = f.render(PlayerTrackTitle, props);
    assert.equal(
        find(tree, (n) => n.type === "Pressable").props.disabled,
        true,
    );
    assert.equal(
        find(tree, (n) => n.type === "ModalPopup").props.visible,
        false,
    );
});

// The player wrapper and Admin both delegate to the same masked renderer.
function renderTabIcons(f, component, props) {
    const wrapper = f.render(component, props);
    return wrapper.type?.name === "MaskedTabIcons"
        ? f.render(wrapper.type, wrapper.props)
        : wrapper;
}

test("the pill masks switch partial glyphs between outline and filled accent layers", () => {
    const f = fixture();
    const { PlayerTabIcons } = f.load(
        "src/components/custom/media-player/player-bar.tsx",
    );
    const tree = renderTabIcons(f, PlayerTabIcons, {
        barWidth: 304,
        pageWidth: 400,
        scrollX: { get: () => 200 },
        selectedTab: "player",
        onSelect() {},
    });
    const outside = find(tree, (node) => node.type === "MaskedView");
    const active = find(
        tree,
        (node) => node.type === "MaskedView" && node !== outside,
    );
    assert.ok(outside && active);
    const outerPath = outside.props.maskElement.props.children.props;
    const innerPath = active.props.maskElement.props.children.props;
    assert.equal(outerPath.fillRule, "evenodd");
    assert.equal(
        outerPath.animatedProps.d,
        `M0,0H300V58H0Z${innerPath.animatedProps.d}`,
    );
    assert.equal(outside.props.pointerEvents, "none");
    assert.equal(active.props.androidRenderingMode, "software");
    assert.equal(
        find(outside, (node) => node.props?.sf === "tag").props.color,
        "#888888",
    );
    assert.equal(
        find(active, (node) => node.props?.sf === "tag.fill").props.color,
        "#ff2255",
    );
});

test("the glass toggle has a sized touch target and decorative children cannot intercept taps", () => {
    const f = fixture();
    const { GlassToggle } = f.load("src/components/ui/glass-toggle.tsx");
    const changes = [];
    const node = f.render(GlassToggle, {
        value: true,
        onValueChange: (value) => changes.push(value),
        accessibilityLabel: "Include all with tags",
    });
    assert.equal(node.props.accessibilityRole, "switch");
    assert.equal(node.props.children.props.pointerEvents, "none");
    node.props.onPress();
    assert.deepEqual(changes, [false]);
});

test("player bar uses compatible directional activation and failure thresholds", () => {
    const { gesture } = barFixture();
    assert.equal(gesture.minDistance, undefined);
    assert.deepEqual(Array.from(gesture.activeOffsetX), [-1, 1]);
    assert.deepEqual(Array.from(gesture.failOffsetY), [-12, 12]);
});

test("tab buttons animate to their respective pages without requiring a swipe", () => {
    for (const [label, tab, x] of [
        ["Discuss", "discuss", 0],
        ["Player", "player", 400],
        ["Tags", "tags", 800],
    ]) {
        const f = barFixture();
        const icons = renderTabIcons(f, f.icons.type, f.icons.props);
        const button = find(
            icons,
            (n) =>
                n.type === "Pressable" && n.props.accessibilityLabel === label,
        );
        button.props.onPress();
        assert.deepEqual(f.selections, [tab]);
        f.rerender();
        f.flushEffects();
        assert.equal(f.commands.at(-1).x, x);
        assert.equal(f.commands.at(-1).animated, true);
    }
});

test("pill drag follows the finger and settles on release", () => {
    const f = barFixture();
    f.gesture.onTouchesDown({ changedTouches: [{ x: 180 }] });
    assert.equal(
        f.commands.length,
        0,
        "touching the selected pill does not navigate",
    );
    f.gesture.onUpdate({ x: 300 });
    assert.ok(f.commands.at(-1).x > 600);
    assert.equal(f.commands.at(-1).animated, false);
    f.gesture.onDeactivate({ canceled: false, velocityX: 0 });
    f.gesture.onFinalize({ canceled: false });
    assert.equal(f.commands.at(-1).x, 800);
    assert.deepEqual(f.selections, ["tags"]);
    assert.equal(f.options.at(-1).gestureEnabled, true);
});

test("a stationary pill touch leaves the selected tab unchanged", () => {
    const f = barFixture();
    f.gesture.onTouchesDown({ changedTouches: [{ x: 180 }] });
    f.gesture.onFinalize({ canceled: true });
    assert.deepEqual(f.selections, []);
    assert.equal(f.commands.at(-1).x, 400);
});

test("an interrupted native animation cannot undo a tapped tab", () => {
    const f = barFixture();
    f.flushEffects();
    f.commands.length = 0;
    f.icons.props.onSelect("tags");
    const tree = f.rerender();
    f.flushEffects();
    assert.equal(f.commands.length, 1, "one animation owner per tap");
    assert.equal(f.commands[0].x, 800);
    const pages = find(tree, (n) => n.type === "AnimatedScrollView");
    pages.props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { x: 420 } },
    });
    pages.props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { x: 400 } },
    });
    assert.deepEqual(
        f.selections,
        ["tags"],
        "old animation completion cannot reselect Player",
    );
    f.rerender();
    f.flushEffects();
    assert.equal(f.commands.length, 1, "no reverse animation is scheduled");
    pages.props.onScrollBeginDrag();
    pages.props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { x: 0 } },
    });
    assert.deepEqual(
        f.selections,
        ["tags", "discuss"],
        "real page swipes still select tabs",
    );
});

test("a swipe starting outside the pill animates toward the finger, then tracks absolute x", () => {
    const f = barFixture();
    f.gesture.onTouchesDown({ changedTouches: [{ x: 20 }] });
    assert.equal(f.commands.length, 0, "press-down leaves ordinary taps alone");
    f.gesture.onUpdate({ x: 40 });
    assert.equal(f.commands.at(-1).animated, true);
    f.gesture.onUpdate({ x: 180 });
    assert.equal(f.commands.at(-1).animated, false);
    assert.equal(
        f.commands.at(-1).x,
        400,
        "pill center follows the bar's center",
    );
});

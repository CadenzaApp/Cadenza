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
        useEffect() {},
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
                    selectedTab: "player",
                    selectTab: (tab) => selections.push(tab),
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
    return { ...f, shell, gesture: shell.props.gesture };
}

test("the player drag detector attaches directly to the non-flattened native bar", () => {
    const f = barFixture();
    const detector = find(
        f.render(f.shell.type, f.shell.props),
        (n) => n.type === "GestureDetector",
    );
    assert.ok(detector, "attach the detector to the bar itself");
    assert.equal(detector.props.children.type, "AnimatedView");
    assert.equal(detector.props.children.props.collapsable, false);
});
test("bar drag callbacks move pages without screen measurement and release the sheet", () => {
    const f = barFixture(),
        g = f.gesture;
    assert.equal(g.enabled, true);
    g.onTouchesDown({ changedTouches: [{ x: 2 }] });
    assert.equal(
        f.commands.at(-1).x,
        0,
        "touching left targets the nearest tab",
    );
    assert.equal(
        f.commands.at(-1).animated,
        true,
        "press-down animates instead of jumping",
    );
    g.onActivate({});
    g.onUpdate({ x: 300 });
    assert.ok(f.commands.at(-1).x > 600);
    assert.equal(f.commands.at(-1).animated, false);
    g.onDeactivate({ canceled: false, velocityX: 0 });
    g.onFinalize({ canceled: false });
    assert.equal(f.commands.at(-1).x, 800);
    assert.deepEqual(f.selections, ["tags"]);
    assert.equal(f.options[0].gestureEnabled, false);
    assert.equal(f.options.at(-1).gestureEnabled, true);
});
test("canceled bar drags snap back without selecting another tab", () => {
    const f = barFixture(),
        g = f.gesture;
    g.onTouchesDown({ changedTouches: [{ x: 180 }] });
    g.onActivate({});
    g.onUpdate({ x: 60 });
    g.onDeactivate({ canceled: true, velocityX: -500 });
    g.onFinalize({ canceled: true });
    assert.equal(f.commands.at(-1).x, 400);
    assert.equal(f.selections.length, 0);
    assert.equal(f.options.at(-1).gestureEnabled, true);
});
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

test("the pill masks switch partial glyphs between outline and filled accent layers", () => {
    const f = fixture();
    const { PlayerTabIcons } = f.load(
        "src/components/custom/media-player/player-bar.tsx",
    );
    const tree = f.render(PlayerTabIcons, {
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

test("a press and release without pan activation selects the touched tab", () => {
    const f = barFixture(),
        g = f.gesture;
    g.onTouchesDown({ changedTouches: [{ x: 2 }] });
    assert.equal(f.commands.at(-1).x, 0);
    g.onTouchesUp();
    g.onFinalize({ canceled: true });
    assert.equal(f.commands.at(-1).x, 0);
    assert.deepEqual(f.selections, ["discuss"]);
    assert.equal(f.options.at(-1).gestureEnabled, true);
});

test("press-down animates to the nearest tab center even away from its center", () => {
    const f = barFixture(),
        g = f.gesture;
    g.onTouchesDown({ changedTouches: [{ x: 100 }] });
    assert.equal(f.commands.at(-1).x, 0);
    g.onTouchesDown({ changedTouches: [{ x: 200 }] });
    assert.equal(f.commands.at(-1).x, 400);
    g.onTouchesDown({ changedTouches: [{ x: 260 }] });
    assert.equal(f.commands.at(-1).x, 800);
    assert.equal(f.commands.at(-1).animated, true);
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

/* global __dirname */
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const babel = require("@babel/core");

const root = path.resolve(__dirname, "..");
const code = babel.transformFileSync(
    path.join(root, "src/features/library/library-song-preferences.ts"),
    {
        cwd: root,
        caller: {
            name: "metro",
            platform: "ios",
            isDev: true,
            supportsStaticESM: true,
            supportsReactCompiler: true,
        },
        plugins: ["@babel/plugin-transform-modules-commonjs"],
    },
).code;

// A mounted hook runner: setters schedule renders and effects run after commit.
// Tests observe updates without calling render again, unlike the previous SWR mock.
function mount(storage = new Map(), initialAccount = "one") {
    const slots = [];
    let cursor = 0;
    let effects = [];
    let scheduled = false;
    let mounted = true;
    let accountId = initialAccount;
    let snapshot;
    let failWrite = false;
    let finishWrite = null;
    const slot = (create) => {
        const index = cursor++;
        return (slots[index] ??= create());
    };
    const schedule = () => {
        if (!mounted || scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            if (mounted) render();
        });
    };
    const react = {
        useState(initial) {
            const state = slot(() => ({
                value: typeof initial === "function" ? initial() : initial,
            }));
            return [
                state.value,
                (next) => {
                    const value =
                        typeof next === "function" ? next(state.value) : next;
                    if (!Object.is(value, state.value)) {
                        state.value = value;
                        schedule();
                    }
                },
            ];
        },
        useEffect(effect, deps) {
            const state = slot(() => ({}));
            if (
                !state.deps ||
                deps.some((value, i) => !Object.is(value, state.deps[i]))
            ) {
                state.deps = deps;
                effects.push(() => {
                    state.cleanup?.();
                    state.cleanup = effect();
                });
            }
        },
        useRef: (initial) => slot(() => ({ current: initial })),
        useMemo: (fn) => fn(),
        useCallback: (fn) => fn,
    };
    const context = {
        exports: {},
        require(name) {
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
            if (name === "@/lib/account")
                return {
                    useAccount: () => ({
                        account: accountId ? { id: accountId } : null,
                    }),
                };
            if (name === "@react-native-async-storage/async-storage")
                return {
                    __esModule: true,
                    default: {
                        getItem: async (key) => storage.get(key) ?? null,
                        setItem: async (key, value) => {
                            if (finishWrite)
                                await new Promise((resolve) => {
                                    finishWrite.resolve = resolve;
                                });
                            if (failWrite)
                                throw new Error("Storage unavailable");
                            storage.set(key, value);
                        },
                    },
                };
            if (name.startsWith("@babel/runtime/")) return require(name);
            throw new Error(`Unexpected dependency: ${name}`);
        },
    };
    vm.runInNewContext(code, context);
    function render() {
        cursor = 0;
        effects = [];
        snapshot = context.exports.useLibrarySongPreferences();
        for (const effect of effects) effect();
    }
    render();
    return {
        get value() {
            return snapshot;
        },
        storage,
        failWrites() {
            failWrite = true;
        },
        holdWrite() {
            finishWrite = {};
        },
        releaseWrite() {
            finishWrite.resolve();
            finishWrite = null;
        },
        switchAccount(id) {
            accountId = id;
            schedule();
        },
        unmount() {
            mounted = false;
            for (const state of slots) state.cleanup?.();
        },
    };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const key = (id) => `cadenza.library.songs.show-all-tagged:${id}`;

test("a tap updates the mounted preference before persistence finishes, without navigation", async () => {
    const screen = mount();
    await settle();
    assert.equal(screen.value.ready, true);
    assert.equal(screen.value.showAllTagged, true);
    screen.holdWrite();
    const saving = screen.value.setShowAllTagged(false);
    await settle();
    assert.equal(screen.value.showAllTagged, false);
    assert.equal(screen.value.saving, true);
    assert.equal(screen.storage.has(key("one")), false);
    screen.releaseWrite();
    await saving;
    await settle();
    assert.equal(screen.value.saving, false);
    assert.equal(screen.value.showAllTagged, false);
    assert.equal(screen.storage.get(key("one")), "false");
    await screen.value.setShowAllTagged(true);
    await settle();
    assert.equal(screen.value.showAllTagged, true);
    assert.equal(screen.storage.get(key("one")), "true");
    screen.unmount();
});

test("the saved off value restores in a new session and stays account scoped", async () => {
    const storage = new Map([[key("one"), "false"]]);
    const screen = mount(storage);
    await settle();
    assert.equal(screen.value.showAllTagged, false);
    screen.switchAccount("two");
    await settle();
    assert.equal(screen.value.showAllTagged, true);
    screen.switchAccount("one");
    await settle();
    assert.equal(screen.value.showAllTagged, false);
    screen.unmount();
    const nextSession = mount(storage);
    await settle();
    assert.equal(nextSession.value.showAllTagged, false);
    nextSession.unmount();
});

test("a failed save rolls back the mounted switch and exposes the error", async () => {
    const screen = mount();
    await settle();
    screen.failWrites();
    await assert.rejects(screen.value.setShowAllTagged(false));
    await settle();
    assert.equal(screen.value.showAllTagged, true);
    assert.equal(screen.value.saving, false);
    assert.ok(screen.value.saveError);
    screen.unmount();
});

test("an old account's pending write cannot overwrite the active account", async () => {
    const screen = mount();
    await settle();
    screen.holdWrite();
    const saving = screen.value.setShowAllTagged(false);
    screen.switchAccount("two");
    await settle();
    assert.equal(screen.value.showAllTagged, true);
    screen.releaseWrite();
    await saving;
    await settle();
    assert.equal(screen.value.showAllTagged, true);
    assert.equal(screen.storage.get(key("one")), "false");
    screen.unmount();
});

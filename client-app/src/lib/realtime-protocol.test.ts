import assert from "node:assert/strict";
import test from "node:test";

import {
    addSample,
    clockOffsetSample,
    medianOffset,
    parseServerMessage,
    reconnectDelayMs,
    socketUrl,
    topicKey,
} from "./realtime-protocol.ts";

test("topic keys tell kinds and ids apart", () => {
    assert.equal(topicKey({ kind: "user", id: "a" }), "user:a");
    assert.notEqual(
        topicKey({ kind: "shared_playlist", id: 1 }),
        topicKey({ kind: "live_session", id: "1" }),
    );
});

test("frames parse by type and junk is dropped", () => {
    const event = parseServerMessage(
        '{"type":"event","topic":{"kind":"user","id":"a"},"version":3,"kind":"now_playing","data":null}',
    );
    assert.equal(event?.type, "event");
    assert.equal(parseServerMessage("not json"), null);
    assert.equal(parseServerMessage('{"no":"type"}'), null);
});

test("reconnects back off and cap at 30 s", () => {
    assert.equal(reconnectDelayMs(0), 1_000);
    assert.equal(reconnectDelayMs(3), 8_000);
    assert.equal(reconnectDelayMs(20), 30_000);
});

test("clock offset takes the midpoint and the median", () => {
    // sent at 1000, back at 1100, server said 5050 at the midpoint, 1050
    assert.equal(clockOffsetSample(1_000, 1_100, 5_050), 4_000);
    assert.equal(medianOffset([10, 500, 12]), 12);
    assert.equal(medianOffset([10, 20]), 15);
    assert.equal(medianOffset([]), 0);
    assert.deepEqual(addSample([1, 2, 3, 4, 5], 6), [2, 3, 4, 5, 6]);
});

test("socket url swaps the scheme", () => {
    assert.equal(
        socketUrl("http://192.168.1.2:3000"),
        "ws://192.168.1.2:3000/realtime/ws",
    );
    assert.equal(
        socketUrl("https://api.example.com"),
        "wss://api.example.com/realtime/ws",
    );
});

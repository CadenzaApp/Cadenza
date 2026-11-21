import assert from "node:assert/strict";
import test from "node:test";
import type { ArtistDetail } from "@apple-musickit";
import {
    createHiddenSpotlightStore,
    resolveMusicTopic,
} from "./spotlight-data.ts";

test("the reported native song error falls through to the artist lookup", async () => {
    const artist = { id: "artist", name: "Artist" } as ArtistDetail;
    const result = await resolveMusicTopic(
        "artist",
        async () => {
            throw new Error(
                "The operation couldn't be completed. (MusicKit.MusicDataRequest.Error error 1.)",
            );
        },
        async () => artist,
    );
    assert.deepEqual(result, { kind: "artist", item: artist });
});

test("authentication failures do not fall through to another resource", async () => {
    const error = Object.assign(
        new Error("Apple Music rejected credentials (403)"),
        { code: "ERR_APPLE_MUSIC_AUTH" },
    );
    await assert.rejects(
        resolveMusicTopic(
            "id",
            async () => {
                throw error;
            },
            async () => {
                assert.fail("Must preserve credential recovery");
            },
        ),
        (received) => received === error,
    );
});

test("a stalled topic lookup ends instead of loading forever", async () => {
    const stalled = () => new Promise<never>(() => {});
    await assert.rejects(
        resolveMusicTopic("id", stalled, stalled, 5),
        /timed out/,
    );
});

test("concurrent dismissals preserve existing data and account isolation", async () => {
    const data = new Map([["a", "[1]"]]);
    const storage = {
        getItem: async (key: string) => data.get(key) ?? null,
        setItem: async (key: string, value: string) => {
            data.set(key, value);
        },
    };
    const store = createHiddenSpotlightStore(storage);
    await Promise.all([
        store.hide("a", 2),
        store.hide("a", 3),
        store.hide("b", 4),
    ]);
    assert.deepEqual(
        await createHiddenSpotlightStore(storage).read("a"),
        [1, 2, 3],
    );
    assert.deepEqual(await store.read("b"), [4]);
});

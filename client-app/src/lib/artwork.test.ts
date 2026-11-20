import assert from "node:assert/strict";
import test from "node:test";
import { playerArtworkUrl, thumbnailArtworkUrl } from "./artwork.ts";
test("live-session thumbnails get a separate player-sized Apple URL", () => {
    assert.equal(
        playerArtworkUrl(
            "https://is1-ssl.mzstatic.com/image/thumb/abc/200x200bb.jpg?x=1",
        ),
        "https://is1-ssl.mzstatic.com/image/thumb/abc/1200x1200bb.jpg?x=1",
    );
    assert.equal(
        playerArtworkUrl(
            "https://is1-ssl.mzstatic.com/image/thumb/abc/512x512bb.webp",
        ),
        "https://is1-ssl.mzstatic.com/image/thumb/abc/1200x1200bb.webp",
    );
});
test("preserves other sources and missing artwork", () => {
    assert.equal(
        playerArtworkUrl("https://example.com/200x200.jpg"),
        "https://example.com/200x200.jpg",
    );
    assert.equal(playerArtworkUrl(null), undefined);
    assert.equal(playerArtworkUrl("invalid"), "invalid");
});

test("list thumbnails request 200 pixels while keeping the player variant separate", () => {
    for (const size of [100, 175, 200, 512, 1200]) {
        const url = `https://is1-ssl.mzstatic.com/image/thumb/abc/${size}x${size}bb.webp?x=1`;
        assert.equal(
            thumbnailArtworkUrl(url),
            "https://is1-ssl.mzstatic.com/image/thumb/abc/200x200bb.webp?x=1",
        );
        assert.equal(
            playerArtworkUrl(url),
            "https://is1-ssl.mzstatic.com/image/thumb/abc/1200x1200bb.webp?x=1",
        );
    }
    assert.equal(
        thumbnailArtworkUrl("https://example.com/512x512.jpg"),
        "https://example.com/512x512.jpg",
    );
    assert.equal(thumbnailArtworkUrl(undefined), undefined);
});

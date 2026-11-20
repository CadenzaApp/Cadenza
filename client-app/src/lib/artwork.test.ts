import assert from "node:assert/strict";
import test from "node:test";
import { playerArtworkUrl } from "./artwork.ts";
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

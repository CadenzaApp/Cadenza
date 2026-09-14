import { MediaPlayer } from "./media-player";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";

/**
 * Keeps playback state global while limiting the visual player to the routes
 * that make room for it. Everything about where the bar sits lives in
 * `useScreenOverlayInsets`; this only decides whether it renders at all. Sheets
 * presented over those routes keep the bar mounted and in place, so dismissing
 * one does not make it jump.
 */
export function MediaPlayerHost() {
    const { compactPlayerVisible } = useScreenOverlayInsets();

    if (!compactPlayerVisible) return null;

    return <MediaPlayer />;
}

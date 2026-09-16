export function tagFadeStart(viewportWidth: number, fadeWidth: number) {
    if (viewportWidth <= 0) return 0.9;
    return Math.max(0, Math.min(1, 1 - fadeWidth / viewportWidth));
}

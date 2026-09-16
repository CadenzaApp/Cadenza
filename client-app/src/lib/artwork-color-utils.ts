/** Equal-channel average of the available six-digit hex artwork colors. */
export function averageArtworkColors(
    colors: readonly (string | null | undefined)[],
) {
    const validColors = colors.filter(
        (color): color is string =>
            typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color),
    );
    if (validColors.length === 0) return null;

    const averageChannel = (start: number) =>
        Math.round(
            validColors.reduce(
                (total, color) =>
                    total + parseInt(color.slice(start, start + 2), 16),
                0,
            ) / validColors.length,
        )
            .toString(16)
            .padStart(2, "0");

    return `#${averageChannel(1)}${averageChannel(3)}${averageChannel(5)}`;
}

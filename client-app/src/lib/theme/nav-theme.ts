import {
    DarkTheme,
    DefaultTheme,
    type Theme,
} from "expo-router/react-navigation";

import type { ColorScheme, Palette } from "./tokens";

/** Builds the react-navigation theme from a resolved palette. */
export function navThemeFor(scheme: ColorScheme, palette: Palette): Theme {
    const base = scheme === "dark" ? DarkTheme : DefaultTheme;
    return {
        ...base,
        colors: {
            background: palette.background,
            border: palette.border,
            card: palette.card,
            notification: palette.brand,
            primary: palette.primary,
            text: palette.foreground,
        },
    };
}

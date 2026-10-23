import { ThemeProvider } from "expo-router/react-navigation";
import { useColorScheme, vars } from "nativewind";
import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    type ReactNode,
} from "react";
import { StyleSheet, View } from "react-native";

import { useUserSettings, type GlassStyle } from "@/lib/routes/settings";

import { navThemeFor } from "./nav-theme";
import { customBackground } from "@/lib/swatch-sets";

import {
    paletteCssVars,
    resolvePalette,
    schemeForBackground,
    type ColorScheme,
    type Palette,
} from "./tokens";

export type AppTheme = {
    scheme: ColorScheme;
    /** Every token, with the user's accent applied as `brand`. */
    colors: Palette;
    glass: {
        /** `#rrggbb` the user washes glass with, or null for none. */
        tint: string | null;
        /** Clear is plain glass. Tinted lays the card color over it. */
        style: GlassStyle;
    };
};

const AppThemeContext = createContext<AppTheme | null>(null);

/** The resolved theme. Use this rather than branching on the color scheme. */
export function useAppTheme(): AppTheme {
    const theme = useContext(AppThemeContext);
    if (!theme) throw new Error("useAppTheme requires AppThemeProvider.");
    return theme;
}

/**
 * The resolved theme, or null outside the provider. For primitives like glass
 * that also render where the provider is not mounted.
 */
export function useOptionalAppTheme(): AppTheme | null {
    return useContext(AppThemeContext);
}

/**
 * Resolves the user's appearance settings into one theme and hands it to
 * everything that draws color: nativewind classes through CSS variables, the
 * navigation theme, and JS readers through `useAppTheme`. Also sets light,
 * dark, or system on the native appearance, so sheets and liquid glass follow.
 * The custom mode sets whichever of light or dark suits its background.
 *
 * Mounted under `UserSettingsProvider`. Signed out it draws the defaults.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
    const { settings } = useUserSettings();
    const { colorScheme, setColorScheme } = useColorScheme();
    const background =
        settings.theme_mode === "custom" ? customBackground(settings) : null;
    // light and dark are read from the setting, not back from nativewind,
    // which only catches up after the effect below
    const scheme: ColorScheme = background
        ? schemeForBackground(background)
        : settings.theme_mode === "light" || settings.theme_mode === "dark"
          ? settings.theme_mode
          : colorScheme === "dark"
            ? "dark"
            : "light";
    const nativeMode =
        settings.theme_mode === "custom" ? scheme : settings.theme_mode;

    useEffect(() => {
        setColorScheme(nativeMode);
    }, [setColorScheme, nativeMode]);

    const theme = useMemo<AppTheme>(
        () => ({
            scheme,
            colors: resolvePalette(scheme, {
                accent: settings.accent_color,
                background,
            }),
            glass: {
                tint: settings.glass_tint,
                style: settings.glass_style ?? "clear",
            },
        }),
        [
            scheme,
            background,
            settings.accent_color,
            settings.glass_tint,
            settings.glass_style,
        ],
    );
    const navTheme = useMemo(
        () => navThemeFor(scheme, theme.colors),
        [scheme, theme.colors],
    );
    const cssVars = useMemo(
        () => vars(paletteCssVars(theme.colors)),
        [theme.colors],
    );

    return (
        <AppThemeContext.Provider value={theme}>
            <ThemeProvider value={navTheme}>
                <View style={[styles.root, cssVars]}>{children}</View>
            </ThemeProvider>
        </AppThemeContext.Provider>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
});

import type { ComponentProps } from "react";
import type { Stack } from "expo-router";
import {
    DarkTheme,
    DefaultTheme,
    type Theme,
} from "expo-router/react-navigation";

/** The options a `Stack.Screen` accepts, which expo-router does not export. */
type StackScreenOptions = NonNullable<
    ComponentProps<typeof Stack.Screen>["options"]
>;

export const THEME = {
    light: {
        background: "#ffffff",
        foreground: "#0a0a0a",
        card: "#fcfcfc",
        cardForeground: "#0a0a0a",
        popover: "#fcfcfc",
        popoverForeground: "#0a0a0a",
        primary: "#171717",
        primaryForeground: "#fafafa",
        secondary: "#ededed",
        secondaryForeground: "#171717",
        muted: "#f5f5f5",
        mutedForeground: "#737373",
        accent: "#f5f5f5",
        accentForeground: "#171717",
        destructive: "#e7000b",
        success: "#22c55e",
        border: "#e5e5e5",
        input: "#e5e5e5",
        ring: "#a1a1a1",
        radius: "0.625rem",
        chart1: "#91c5ff",
        chart2: "#3a81f6",
        chart3: "#2563ef",
        chart4: "#1a4eda",
        chart5: "#1f3fad",
    },
    dark: {
        background: "#0a0a0a",
        foreground: "#fafafa",
        card: "#171717",
        cardForeground: "#fafafa",
        popover: "#262626",
        popoverForeground: "#fafafa",
        primary: "#e5e5e5",
        primaryForeground: "#171717",
        secondary: "#262626",
        secondaryForeground: "#fafafa",
        muted: "#262626",
        mutedForeground: "#a1a1a1",
        accent: "#404040",
        accentForeground: "#fafafa",
        destructive: "#ff6467",
        success: "#4ade80",
        border: "#282828",
        input: "#343434",
        ring: "#737373",
        chart1: "#91c5ff",
        chart2: "#3a81f6",
        chart3: "#2563ef",
        chart4: "#1a4eda",
        chart5: "#1f3fad",
    },
};

/** Named application colors that automatically resolve for light or dark mode. */
export type ThemeColorToken = Exclude<keyof typeof THEME.light, "radius">;

export const NAV_THEME: Record<"light" | "dark", Theme> = {
    light: {
        ...DefaultTheme,
        colors: {
            background: THEME.light.background,
            border: THEME.light.border,
            card: THEME.light.card,
            notification: THEME.light.destructive,
            primary: THEME.light.primary,
            text: THEME.light.foreground,
        },
    },
    dark: {
        ...DarkTheme,
        colors: {
            background: THEME.dark.background,
            border: THEME.dark.border,
            card: THEME.dark.card,
            notification: THEME.dark.destructive,
            primary: THEME.dark.primary,
            text: THEME.dark.foreground,
        },
    },
};

/**
 * How much of the screen a sheet covers. `1` is the system's large detent: the
 * sheet spans the full width, runs to the bottom edge, and stops just below
 * the status bar. Any smaller fraction gets iOS 26's inset card treatment,
 * which leaves gaps down both sides and along the bottom.
 *
 * Exported because the now playing sheet sizes its artwork against the room
 * the sheet leaves, and that estimate has to track this value.
 */
export const SHEET_DETENT = 1;

/**
 * Stack options that present a route as the app's standard sheet: a rounded
 * card at `SHEET_DETENT` of the screen with a native grabber and drag to
 * dismiss. Shared so every sheet route looks the same. Pair it with
 * `DetailScreen` for the header and safe-area padding.
 */
export function sheetScreenOptions(theme: Theme): StackScreenOptions {
    return {
        headerShown: false,
        presentation: "formSheet",
        gestureEnabled: true,
        sheetAllowedDetents: [SHEET_DETENT],
        sheetCornerRadius: 28,
        // Keep an inner ScrollView from turning the drag into a detent change.
        sheetExpandsWhenScrolledToEdge: false,
        sheetGrabberVisible: true,
        sheetInitialDetentIndex: 0,
        contentStyle: { backgroundColor: theme.colors.card },
    };
}

/**
 * Stack options for the pushed detail routes: album, artist, category, tag,
 * the category picker, and the playlist picker.
 *
 * Presented over the screen that opened them rather than replacing it, with no
 * native animation at all. The zoom in `@/lib/zoom-dismiss` is the transition
 * in both directions, and it needs two things the default push does not give
 * it: the screen underneath still on screen to grow out of and shrink back
 * into, and a transparent background so the card's rounded corners show it.
 *
 * The cost is the native back swipe, which a transparent modal has no edge for.
 * The pull down at the top of the screen replaces it.
 */
export function pushedScreenOptions(): StackScreenOptions {
    return {
        headerShown: false,
        presentation: "transparentModal",
        animation: "none",
        contentStyle: { backgroundColor: "transparent" },
    };
}

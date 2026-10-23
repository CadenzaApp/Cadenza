import type { ComponentProps } from "react";
import type { Stack } from "expo-router";
import type { Theme } from "expo-router/react-navigation";

export * from "./tokens";
export { navThemeFor } from "./nav-theme";
export {
    AppThemeProvider,
    useAppTheme,
    useOptionalAppTheme,
    type AppTheme,
} from "./theme-provider";

/** The options a `Stack.Screen` accepts, which expo-router does not export. */
type StackScreenOptions = NonNullable<
    ComponentProps<typeof Stack.Screen>["options"]
>;

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
 * song discuss, the category picker, and the playlist picker.
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

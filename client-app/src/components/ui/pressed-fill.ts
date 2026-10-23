import { useColorScheme } from "nativewind";

import { useOptionalAppTheme } from "@/lib/theme";

/**
 * The shade a pressed glass control lays over its glass: dark on light glass,
 * light on dark glass, so the press shows on either. `scheme` is the glass's
 * own, for a control that floats over artwork rather than the app's surface.
 * Otherwise the app theme's scheme, which a custom background sets too, and
 * nativewind's where the theme is not mounted.
 */
export function usePressedFill(scheme?: "light" | "dark") {
    const appTheme = useOptionalAppTheme();
    const { colorScheme } = useColorScheme();
    const dark = (scheme ?? appTheme?.scheme ?? colorScheme) === "dark";
    return dark ? "#ffffff" : "#000000";
}

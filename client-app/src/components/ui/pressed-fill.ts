import { useColorScheme } from "nativewind";

/**
 * The shade a pressed glass control lays over its glass: dark on light glass,
 * light on dark glass, so the press shows on either. `scheme` is the glass's
 * own, for a control that floats over artwork rather than the app's surface.
 */
export function usePressedFill(scheme?: "light" | "dark") {
    const { colorScheme } = useColorScheme();
    const dark = (scheme ?? colorScheme) === "dark";
    return dark ? "#ffffff" : "#000000";
}

import { Redirect } from "expo-router";
import type { ReactNode } from "react";
import { View } from "react-native";

import { GlassPanel } from "@/components/ui/glass-panel";
import { GlassPill } from "@/components/ui/glass-pill";
import { GlassToggle } from "@/components/ui/glass-toggle";
import { useAccount } from "@/lib/account";
import {
    DEFAULT_USER_SETTINGS,
    useSaveSettings,
    type GlassStyle,
    type UserSettings,
    type ThemeMode,
} from "@/lib/routes/settings";
import { customBackground } from "@/lib/swatch-sets";
import { GLASS_TINT_PRESETS, PALETTE, useAppTheme } from "@/lib/theme";

import {
    SettingsIcon,
    SettingsRow,
    SettingsSheet,
    SaveError,
    SettingsSection,
} from "./settings-ui";
import {
    SegmentedControl,
    type SegmentOption,
} from "@/components/ui/segmented-control";
import { SettingsSwatchGrid } from "./settings-swatch-grid";

const MODES: readonly SegmentOption<ThemeMode>[] = [
    { value: "system", label: "System", icon: "contrast-outline" },
    { value: "light", label: "Light", icon: "sunny-outline" },
    { value: "dark", label: "Dark", icon: "moon-outline" },
    { value: "custom", label: "Custom", icon: "color-palette-outline" },
];

/** The same two choices iOS 26.1 offers for Liquid Glass in Settings. */
const GLASS_STYLES: readonly SegmentOption<GlassStyle>[] = [
    { value: "clear", label: "Clear", icon: "water-outline" },
    { value: "tinted", label: "Tinted", icon: "color-fill-outline" },
];

/** What Reset to defaults puts back. The color slots are left alone. */
const APPEARANCE_KEYS = [
    "theme_mode",
    "accent_color",
    "background_color",
    "glass_tint",
    "glass_style",
] as const satisfies readonly (keyof UserSettings)[];

/**
 * Mode, custom background, accent, glass tint and style. Every change saves
 * to the account and repaints the app at once.
 */
export function AppearanceSettingsScreen() {
    const { account } = useAccount();
    const { settings, save, saveErr } = useSaveSettings("appearance");
    const { scheme } = useAppTheme();

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
    }

    const background = customBackground(settings);

    return (
        <SettingsSheet title="Appearance" className="gap-5">
            <AppearancePreview />

            <SettingsSection title="Mode">
                <SegmentedControl
                    options={MODES}
                    value={settings.theme_mode}
                    onChange={(mode) =>
                        save(
                            mode === "custom" && !settings.background_color
                                ? {
                                      theme_mode: mode,
                                      background_color: background,
                                  }
                                : { theme_mode: mode },
                        )
                    }
                />
            </SettingsSection>

            {settings.theme_mode === "custom" ? (
                <SettingsSection
                    title="Background"
                    footnote="Text turns light or dark to suit the background."
                >
                    <SwatchPanel>
                        <SettingsSwatchGrid
                            kind="background"
                            pickerTitle="Background"
                            selected={background}
                            newColorStart={background}
                        />
                    </SwatchPanel>
                </SettingsSection>
            ) : null}

            <SettingsSection
                title="Accent"
                footnote="Hold a color to change or remove it."
            >
                <SwatchPanel>
                    <SettingsSwatchGrid
                        kind="accent"
                        pickerTitle="Accent color"
                        fixed={{
                            label: "Default",
                            color: PALETTE[scheme].brand,
                        }}
                        newColorStart={PALETTE[scheme].brand}
                    />
                </SwatchPanel>
            </SettingsSection>

            <SettingsSection title="Glass tint">
                <SwatchPanel>
                    <SettingsSwatchGrid
                        kind="glassTint"
                        pickerTitle="Glass tint"
                        fixed={{ label: "None", color: null }}
                        newColorStart={GLASS_TINT_PRESETS[0]}
                    />
                </SwatchPanel>
            </SettingsSection>

            <SettingsSection
                title="Glass Options"
                footnote="Clear is more transparent and tinted increases opacity, adding contrast to content and controls."
            >
                <SegmentedControl
                    options={GLASS_STYLES}
                    value={settings.glass_style}
                    onChange={(style) => save({ glass_style: style })}
                />
            </SettingsSection>

            <SaveError error={saveErr} />

            <View className="items-center">
                <GlassPill
                    icon="refresh-outline"
                    label="Reset to defaults"
                    onPress={() =>
                        save(
                            Object.fromEntries(
                                APPEARANCE_KEYS.map((key) => [
                                    key,
                                    DEFAULT_USER_SETTINGS[key],
                                ]),
                            ),
                        )
                    }
                />
            </View>
        </SettingsSheet>
    );
}

function SwatchPanel({ children }: { children: ReactNode }) {
    return (
        <GlassPanel>
            <View className="p-4">{children}</View>
        </GlassPanel>
    );
}

/** A small sample of the controls the choices above repaint. */
function AppearancePreview() {
    return (
        <GlassPanel>
            <SettingsRow
                icon="color-palette-outline"
                title="Preview"
                description="Toggles, icons, and glass follow your choices."
                trailing={
                    <GlassToggle
                        value
                        onValueChange={() => {}}
                        accessibilityLabel="Preview toggle"
                    />
                }
            />
            <View className="flex-row items-center gap-3 px-4 pb-4">
                <SettingsIcon name="musical-notes" />
                <SettingsIcon name="pricetag-outline" />
                <View className="flex-1" />
                <GlassPill icon="sparkles-outline" label="Glass" />
            </View>
        </GlassPanel>
    );
}

import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DetailScreen } from "@/components/ui/detail-screen";
import { GlassPill } from "@/components/ui/glass-pill";
import { GlassToggle } from "@/components/ui/glass-toggle";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import {
    useUserSettings,
    type GlassStyle,
    type ThemeMode,
    type UserSettingsPatch,
} from "@/lib/routes/settings";
import {
    ACCENT_PRESETS,
    BACKGROUND_PRESETS,
    GLASS_TINT_PRESETS,
    PALETTE,
    useAppTheme,
} from "@/lib/theme";

import { SwatchGrid } from "@/components/custom/color-picker";
import { resolveSwatchSlots } from "@/lib/swatch-slots";

import {
    GlassSettingsPanel,
    SettingsIcon,
    SettingsRow,
    type IoniconName,
} from "./settings-ui";

const MODES: { mode: ThemeMode; label: string; icon: IoniconName }[] = [
    { mode: "system", label: "System", icon: "contrast-outline" },
    { mode: "light", label: "Light", icon: "sunny-outline" },
    { mode: "dark", label: "Dark", icon: "moon-outline" },
    { mode: "custom", label: "Custom", icon: "color-palette-outline" },
];

/** Background slots: two rows of six with the + in the last cell. */
const BACKGROUND_SLOTS = 11;

/** The same two choices iOS 26.1 offers for Liquid Glass in Settings. */
const GLASS_STYLES: { style: GlassStyle; label: string; icon: IoniconName }[] =
    [
        { style: "clear", label: "Clear", icon: "water-outline" },
        { style: "tinted", label: "Tinted", icon: "color-fill-outline" },
    ];

/** Two rows of six: the fixed color, ten slots, and the + button. */
const SWATCH_COLUMNS = 6;
const SWATCH_SLOTS = 10;

/**
 * Mode, custom background, accent, glass tint and style. Every change saves
 * to the account and repaints the app at once.
 */
export function AppearanceSettingsScreen() {
    const insets = useSafeAreaInsets();
    const { account } = useAccount();
    const { settings, settingsLoaded, updateSettings, updateSettingsErr } =
        useUserSettings();
    const { scheme } = useAppTheme();

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
    }

    const backgroundSlots = resolveSwatchSlots(
        settings.background_swatches,
        BACKGROUND_PRESETS,
        BACKGROUND_SLOTS,
    );
    // what the custom mode draws: the picked background, else the first one
    const customBackground =
        settings.background_color ??
        backgroundSlots.find((slot) => slot !== null) ??
        BACKGROUND_PRESETS[0];

    function save(change: UserSettingsPatch) {
        void updateSettings(change).catch((error) =>
            console.error("Failed to save appearance:", error),
        );
    }

    return (
        <DetailScreen presentation="sheet" title="Appearance">
            <ScrollView
                className="flex-1"
                contentContainerClassName="gap-5 px-5 pt-2"
                contentContainerStyle={{
                    paddingBottom: Math.max(insets.bottom, 16) + 16,
                }}
                showsVerticalScrollIndicator={false}
            >
                <AppearancePreview />

                <Section title="Mode">
                    <GlassSettingsPanel>
                        <View
                            accessibilityRole="radiogroup"
                            className="flex-row gap-2 p-2"
                        >
                            {MODES.map(({ mode, label, icon }) => (
                                <Segment
                                    key={mode}
                                    label={label}
                                    icon={icon}
                                    selected={settings.theme_mode === mode}
                                    onPress={() =>
                                        save(
                                            mode === "custom" &&
                                                !settings.background_color
                                                ? {
                                                      theme_mode: mode,
                                                      background_color:
                                                          customBackground,
                                                  }
                                                : { theme_mode: mode },
                                        )
                                    }
                                />
                            ))}
                        </View>
                    </GlassSettingsPanel>
                </Section>

                {settings.theme_mode === "custom" ? (
                    <Section
                        title="Background"
                        footnote="Text turns light or dark to suit the background."
                    >
                        <SwatchPanel>
                            <SwatchGrid
                                pickerTitle="Background"
                                columns={SWATCH_COLUMNS}
                                slots={backgroundSlots}
                                selected={customBackground}
                                onSelect={(color) =>
                                    save({ background_color: color })
                                }
                                onEdit={(slots, selected) =>
                                    save({
                                        background_swatches: slots,
                                        // custom mode always draws something:
                                        // removing the picked one moves on
                                        background_color:
                                            selected ??
                                            slots.find(
                                                (slot) => slot !== null,
                                            ) ??
                                            null,
                                    })
                                }
                                newColorStart={customBackground}
                                editable={settingsLoaded}
                            />
                        </SwatchPanel>
                    </Section>
                ) : null}

                <Section
                    title="Accent"
                    footnote="Hold a color to change or remove it."
                >
                    <SwatchPanel>
                        <SwatchGrid
                            pickerTitle="Accent color"
                            columns={SWATCH_COLUMNS}
                            fixed={{
                                label: "Default",
                                color: PALETTE[scheme].brand,
                            }}
                            slots={resolveSwatchSlots(
                                settings.accent_swatches,
                                ACCENT_PRESETS,
                                SWATCH_SLOTS,
                            )}
                            selected={settings.accent_color}
                            onSelect={(color) => save({ accent_color: color })}
                            onEdit={(slots, selected) =>
                                save({
                                    accent_swatches: slots,
                                    accent_color: selected,
                                })
                            }
                            newColorStart={PALETTE[scheme].brand}
                            editable={settingsLoaded}
                        />
                    </SwatchPanel>
                </Section>

                <Section title="Glass tint">
                    <SwatchPanel>
                        <SwatchGrid
                            pickerTitle="Glass tint"
                            columns={SWATCH_COLUMNS}
                            fixed={{ label: "None", color: null }}
                            slots={resolveSwatchSlots(
                                settings.glass_tint_swatches,
                                GLASS_TINT_PRESETS,
                                SWATCH_SLOTS,
                            )}
                            selected={settings.glass_tint}
                            onSelect={(color) => save({ glass_tint: color })}
                            onEdit={(slots, selected) =>
                                save({
                                    glass_tint_swatches: slots,
                                    glass_tint: selected,
                                })
                            }
                            newColorStart={GLASS_TINT_PRESETS[0]}
                            editable={settingsLoaded}
                        />
                    </SwatchPanel>
                </Section>

                <Section
                    title="Glass"
                    footnote="Tinted makes glass more opaque, for more contrast. The same choice as Liquid Glass in iOS Settings, which Cadenza cannot read."
                >
                    <GlassSettingsPanel>
                        <View
                            accessibilityRole="radiogroup"
                            className="flex-row gap-2 p-2"
                        >
                            {GLASS_STYLES.map(({ style, label, icon }) => (
                                <Segment
                                    key={style}
                                    label={label}
                                    icon={icon}
                                    selected={settings.glass_style === style}
                                    onPress={() => save({ glass_style: style })}
                                />
                            ))}
                        </View>
                    </GlassSettingsPanel>
                </Section>

                {updateSettingsErr ? (
                    <Text className="px-2 text-sm text-destructive">
                        Could not save that change. Please try again.
                    </Text>
                ) : null}

                <View className="items-center">
                    <GlassPill
                        icon="refresh-outline"
                        label="Reset to defaults"
                        onPress={() =>
                            save({
                                theme_mode: "system",
                                accent_color: null,
                                background_color: null,
                                glass_tint: null,
                                glass_style: "clear",
                            })
                        }
                    />
                </View>
            </ScrollView>
        </DetailScreen>
    );
}

function SwatchPanel({ children }: { children: ReactNode }) {
    return (
        <GlassSettingsPanel>
            <View className="p-4">{children}</View>
        </GlassSettingsPanel>
    );
}

function Section({
    title,
    footnote,
    children,
}: {
    title: string;
    footnote?: string;
    children: ReactNode;
}) {
    return (
        <View className="gap-2">
            <Text className="px-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {title}
            </Text>
            {children}
            {footnote ? (
                <Text className="px-2 text-sm leading-5 text-muted-foreground">
                    {footnote}
                </Text>
            ) : null}
        </View>
    );
}

/**
 * One option of a segmented row, an equal share of its width. The selected
 * one fills with the accent. Selection colors are inline styles: toggled
 * classes lagged a step behind when the theme changed under them.
 */
function Segment({
    label,
    icon,
    selected,
    onPress,
}: {
    label: string;
    icon?: IoniconName;
    selected: boolean;
    onPress: () => void;
}) {
    const { colors } = useAppTheme();
    const contentColor = selected ? colors.brandForeground : colors.foreground;

    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ checked: selected }}
            onPress={onPress}
            className="flex-1 active:opacity-60"
        >
            <View
                className="h-16 items-center justify-center gap-1 rounded-2xl"
                style={{
                    backgroundColor: selected ? colors.brand : "transparent",
                }}
            >
                {icon ? (
                    <Ionicons name={icon} size={20} color={contentColor} />
                ) : null}
                <Text
                    className="text-sm font-semibold"
                    style={{ color: contentColor }}
                >
                    {label}
                </Text>
            </View>
        </Pressable>
    );
}

/** A small sample of the controls the choices above repaint. */
function AppearancePreview() {
    return (
        <GlassSettingsPanel>
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
        </GlassSettingsPanel>
    );
}

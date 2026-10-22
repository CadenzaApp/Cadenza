import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useColorScheme } from "nativewind";
import { useState, type ReactNode } from "react";
import { ModalPopup } from "@/components/custom/modal-popup";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassToggle } from "@/components/ui/glass-toggle";
import type { QuerySettings } from "./query-settings";
import { Pressable, View } from "react-native";

const SETTING_ROWS: {
    key: keyof QuerySettings;
    label: string;
    help: string;
    accessibilityLabel: string;
}[] = [
    {
        key: "libraryOnly",
        label: "Show songs only in your library",
        help: "Match only songs in your Apple Music library. When this is off, queries also find songs Cadenza knows from elsewhere.",
        accessibilityLabel: "Show songs only in your library",
    },
    {
        key: "showVennDiagrams",
        label: "Show Venn diagrams",
        help: "Show a small diagram of how each tag group matches songs.",
        accessibilityLabel: "Show Venn diagrams",
    },
    {
        key: "showUndoRedo",
        label: "Show undo/redo",
        help: "Show the undo and redo buttons beside the results button. Up to 20 query edits are kept.",
        accessibilityLabel: "Show undo and redo",
    },
    {
        key: "includeSuggested",
        label: "Show suggested tags",
        help: "Show shared suggested tags in the palette and count them when matching songs in either editor.",
        accessibilityLabel: "Show suggested tags",
    },
    {
        key: "showAdvancedTags",
        label: "Show advanced tags",
        help: "Show tags with text, number, date, time, or checkbox values in the Simple tag palette. Existing query tags stay in place when this is off.",
        accessibilityLabel: "Show advanced tags in tag palette",
    },
    {
        key: "showMetadataTags",
        label: "Show metadata tags",
        help: "Show song fields such as title, artist, release date, and duration in the Simple tag palette. Existing query filters stay in place when this is off.",
        accessibilityLabel: "Show metadata tags in tag palette",
    },
];

export function QuerySettingsDialog({
    visible,
    onClose,
    settings,
    onChange,
    suggestedRequired,
}: {
    visible: boolean;
    onClose: () => void;
    settings: QuerySettings;
    onChange: (key: keyof QuerySettings, value: boolean) => void;
    suggestedRequired: boolean;
}) {
    const [helpOpen, setHelpOpen] = useState<keyof QuerySettings | null>(null);
    function close() {
        setHelpOpen(null);
        onClose();
    }
    return (
        <ModalPopup
            visible={visible}
            onClose={close}
            title="Query settings"
            titleClassName="text-xl font-bold"
            contentStyle={{ width: "90%" }}
        >
            <View className="relative">
                {SETTING_ROWS.map(
                    ({ key, label, help, accessibilityLabel }) => {
                        const required =
                            key === "includeSuggested" && suggestedRequired;
                        return (
                            <QuerySettingRow
                                key={key}
                                label={label}
                                help={
                                    required
                                        ? "Suggested tags appear in the palette and count when matching songs in either editor. Remove them from both query drafts before turning this off; your queries will not be cleared."
                                        : help
                                }
                                helpPlacement={
                                    key === "includeSuggested"
                                        ? "above"
                                        : "below"
                                }
                                helpOpen={helpOpen === key}
                                onHelpPress={() =>
                                    setHelpOpen(helpOpen === key ? null : key)
                                }
                            >
                                {required ? (
                                    <Text
                                        className="text-sm"
                                        accessibilityLabel="Suggested tags required by a query draft"
                                    >
                                        On
                                    </Text>
                                ) : (
                                    <GlassToggle
                                        value={settings[key]}
                                        onValueChange={(value) =>
                                            onChange(key, value)
                                        }
                                        accessibilityLabel={accessibilityLabel}
                                    />
                                )}
                            </QuerySettingRow>
                        );
                    },
                )}
            </View>
            <GlassButton className="mt-3" onPress={close}>
                <Text className="text-sm">Done</Text>
            </GlassButton>
        </ModalPopup>
    );
}

function QuerySettingRow({
    label,
    help,
    helpOpen,
    helpPlacement = "below",
    onHelpPress,
    children,
}: {
    label: string;
    help: string;
    helpOpen: boolean;
    helpPlacement?: "above" | "below";
    onHelpPress: () => void;
    children: ReactNode;
}) {
    const { colorScheme = "light" } = useColorScheme();
    return (
        <View className="py-2" style={{ zIndex: helpOpen ? 10 : 0 }}>
            <View className="min-h-11 flex-row items-center gap-1">
                <Text className="text-sm font-semibold">{label}</Text>
                <Pressable
                    onPress={onHelpPress}
                    accessibilityRole="button"
                    accessibilityLabel={`About ${label}`}
                    accessibilityState={{ expanded: helpOpen }}
                    className="h-8 w-8 items-center justify-center"
                    hitSlop={4}
                >
                    <Ionicons
                        name="information-circle-outline"
                        size={18}
                        color={THEME[colorScheme].mutedForeground}
                    />
                </Pressable>
                <View className="ml-auto">{children}</View>
            </View>
            {helpOpen ? (
                <View
                    className="absolute left-5 right-2 rounded-xl border border-border bg-popover px-3 py-2 shadow-lg"
                    style={{
                        [helpPlacement === "above" ? "bottom" : "top"]: 48,
                        elevation: 20,
                    }}
                >
                    <Text className="text-sm text-muted-foreground">
                        {help}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

export function HistoryActionButton({
    icon,
    label,
    disabled,
    onPress,
    grouped = false,
}: {
    icon: "arrow-undo" | "arrow-redo";
    label: string;
    disabled: boolean;
    onPress: () => void;
    grouped?: boolean;
}) {
    const { colors } = useTheme();
    const content = (
        <View style={{ opacity: disabled ? 0.35 : 1 }}>
            <Ionicons name={icon} size={18} color={colors.text} />
        </View>
    );
    if (grouped) {
        return (
            <Pressable
                onPress={onPress}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ disabled }}
                className="h-9 w-9 items-center justify-center active:opacity-65"
            >
                {content}
            </Pressable>
        );
    }
    return (
        <GlassIconButton
            size={36}
            onPress={onPress}
            accessibilityLabel={label}
            accessibilityState={{ disabled }}
            disabled={disabled}
        >
            {content}
        </GlassIconButton>
    );
}

import type { ReactNode } from "react";
import { StyleSheet, View, type ColorValue } from "react-native";

import { GlassLayer, GlassSurface } from "@/components/ui/glass-surface";
import { cn } from "@/lib/utils";

/** A rounded glass card. Every block on the settings sheets sits on one. */
export function GlassPanel({
    children,
    className,
    tintColor,
}: {
    children: ReactNode;
    className?: string;
    tintColor?: ColorValue;
}) {
    return (
        <View
            className={cn(
                "overflow-hidden rounded-3xl border border-border",
                className,
            )}
        >
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <GlassSurface
                    variant="regular"
                    tintColor={tintColor}
                    style={StyleSheet.absoluteFill}
                />
            </View>
            {/* the glass is a sibling layer, so tell the children they sit on
                it. pills and toggles then skip the tint the panel already has */}
            <GlassLayer>{children}</GlassLayer>
        </View>
    );
}

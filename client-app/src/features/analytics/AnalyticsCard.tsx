import { StyleSheet, View, type ViewProps } from "react-native";

import { GlassSurface } from "@/components/ui/glass-surface";
import { TextClassContext } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/**
 * The surface every section on the tab sits on: liquid glass over the page
 * tint, with the padding and radius the sections share.
 *
 * The glass is a sibling layer under the content rather than the container
 * itself, the way `GlassButton` does it, so the content lays out as a plain
 * view and the glass only paints.
 */
export function AnalyticsCard({ className, children, ...rest }: ViewProps) {
    return (
        <TextClassContext.Provider value="text-card-foreground">
            <View
                className={cn(
                    "gap-4 overflow-hidden rounded-3xl border border-border p-5",
                    className,
                )}
                {...rest}
            >
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <GlassSurface
                        variant="regular"
                        style={StyleSheet.absoluteFill}
                    />
                </View>
                {children}
            </View>
        </TextClassContext.Provider>
    );
}

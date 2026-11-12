import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { PLAYER_CONTROL_SIZE } from "@/lib/screen-overlay-geometry";
import { useAppTheme } from "@/lib/theme";

/**
 * The round button that opens the assistant sheet. The media player host
 * draws it at the right end of the shared bottom row, with the sort button to
 * its left, whenever a focused screen asks for it with `useBottomRowAssistant`:
 * every tab's own screen and every song list with a sort button.
 */
export function AssistantRowButton({ disabled }: { disabled: boolean }) {
    const router = useRouter();
    const { colors } = useAppTheme();
    return (
        <GlassIconButton
            size={PLAYER_CONTROL_SIZE}
            bordered={false}
            style={{ borderRadius: PLAYER_CONTROL_SIZE / 2 }}
            disabled={disabled}
            onPress={() => router.push("/assistant")}
            accessibilityLabel="Open the assistant"
        >
            <Ionicons name="sparkles" size={24} color={colors.brand} />
        </GlassIconButton>
    );
}

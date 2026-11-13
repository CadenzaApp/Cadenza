import { useRouter, type Href } from "expo-router";
import { View } from "react-native";

import { GlassPill } from "@/components/ui/glass-pill";

/**
 * New and Enter code side by side, each half the row, above a list of shared
 * things like shared playlists or shared queries. Enter code opens the join
 * sheet.
 */
export function NewOrJoinRow({
    newLabel,
    onNew,
}: {
    newLabel: string;
    onNew: () => void;
}) {
    const router = useRouter();
    return (
        <View className="flex-row gap-3">
            <GlassPill
                className="flex-1 active:opacity-60"
                size="md"
                icon="add"
                label={newLabel}
                onPress={onNew}
            />
            <GlassPill
                className="flex-1 active:opacity-60"
                size="md"
                icon="keypad-outline"
                label="Enter code"
                onPress={() => router.push("/join" as Href)}
            />
        </View>
    );
}

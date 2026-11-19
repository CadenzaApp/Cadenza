import { useState } from "react";
import { View } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassInput } from "@/components/ui/glass-input";
import { Text } from "@/components/ui/text";

/**
 * Asks for a new playlist's name. `create` makes it and goes wherever it
 * opens; a throw shows a retry line. Used for both Apple Music and shared
 * playlists, so only `create` differs.
 */
export function NewPlaylistPopup({
    title = "New playlist",
    onClose,
    create,
}: {
    title?: string;
    onClose: () => void;
    create: (name: string) => Promise<void>;
}) {
    const [name, setName] = useState("");
    const [pending, setPending] = useState(false);
    const [failed, setFailed] = useState(false);
    const trimmed = name.trim();

    async function submit() {
        if (!trimmed || pending) return;
        setFailed(false);
        setPending(true);
        try {
            await create(trimmed);
        } catch {
            setFailed(true);
        } finally {
            setPending(false);
        }
    }

    return (
        <ModalPopup visible keyboardAware onClose={onClose} title={title}>
            <View className="gap-3 px-1 pb-1">
                <GlassInput
                    placeholder="Name"
                    value={name}
                    onChangeText={setName}
                    maxLength={100}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={() => void submit()}
                />
                {failed ? (
                    <Text className="text-sm text-destructive">
                        Couldn&apos;t make the playlist. Try again.
                    </Text>
                ) : null}
                <GlassButton
                    disabled={!trimmed || pending}
                    onPress={() => void submit()}
                >
                    <Text className="font-semibold text-foreground">
                        {pending ? "Creating..." : "Create"}
                    </Text>
                </GlassButton>
            </View>
        </ModalPopup>
    );
}

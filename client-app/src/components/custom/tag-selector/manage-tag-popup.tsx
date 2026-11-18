import { View, useWindowDimensions } from "react-native";
import { TagPill } from "@/components/custom/tag-pill";
import { MusicListActionButton } from "@/components/custom/music-list/music-list-action-button";
import { useState } from "react";
import { EditTagDialog } from "@/components/custom/edit-tag-dialog";
import { ModalPopup } from "@/components/custom/modal-popup";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { tagMutationErrorMessage, useDeleteTag } from "@/lib/routes/tags";
import type { Tag } from "@/lib/types";

/** Management for an owned tag. Suggested tags never open this menu. */
export function ManageTagPopup({
    tag,
    onClose,
    onUpdated,
    onDeleted,
}: {
    tag: Tag;
    onClose: () => void;
    onUpdated: (tag: Tag) => void;
    onDeleted: (tagId: number) => void;
}) {
    const { width } = useWindowDimensions();
    const [mode, setMode] = useState<"menu" | "name" | "color" | "delete">(
        "menu",
    );
    const { deleteTag, deleteTagErr, deleteTagLoading } = useDeleteTag();
    async function remove() {
        try {
            await deleteTag({ tag_id: tag.id });
            onDeleted(tag.id);
            onClose();
        } catch {
            // Keep the confirmation open so the user can retry.
        }
    }
    if (mode === "name" || mode === "color") {
        return (
            <EditTagDialog
                tag={tag}
                mode={mode}
                onClose={onClose}
                onUpdated={onUpdated}
            />
        );
    }
    return (
        <ModalPopup
            visible
            contentStyle={{
                width: (width - 32) * 0.7 * 0.85,
                minWidth: 204,
                maxWidth: 340,
            }}
            onClose={deleteTagLoading ? () => undefined : onClose}
            title={mode === "delete" ? "Delete tag?" : undefined}
        >
            <View className="items-center pb-3 pt-1">
                <TagPill tag={tag} height={16} />
            </View>
            {mode === "delete" ? (
                <>
                    <Text className="text-muted-foreground">
                        This removes the tag from all songs.
                    </Text>
                    {deleteTagErr ? (
                        <Text className="text-destructive">
                            {tagMutationErrorMessage(deleteTagErr)}
                        </Text>
                    ) : null}
                    <Button
                        variant="destructive"
                        disabled={deleteTagLoading}
                        onPress={() => void remove()}
                    >
                        <Text>
                            {deleteTagLoading ? "Deleting..." : "Delete tag"}
                        </Text>
                    </Button>
                    <Button
                        variant="ghost"
                        disabled={deleteTagLoading}
                        onPress={onClose}
                    >
                        <Text>Cancel</Text>
                    </Button>
                </>
            ) : (
                <>
                    {(
                        [
                            {
                                id: "name",
                                label: "Rename tag",
                                icon: "pencil-outline",
                            },
                            {
                                id: "color",
                                label: "Change color",
                                icon: "color-palette-outline",
                            },
                            {
                                id: "delete",
                                label: "Delete tag",
                                icon: "trash-outline",
                                labelColor: "destructive",
                                iconColor: "destructive",
                            },
                        ] as const
                    ).map((action) => (
                        <MusicListActionButton
                            key={action.id}
                            target={tag}
                            action={{
                                ...action,
                                onPress: () => setMode(action.id),
                            }}
                        />
                    ))}
                </>
            )}
        </ModalPopup>
    );
}

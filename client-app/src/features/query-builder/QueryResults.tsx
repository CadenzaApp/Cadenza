import type { MusicItem } from "@apple-musickit";
import { useMemo, useState } from "react";
import { Platform, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

import { TrackCollectionView } from "@/components/custom/track-collection-view";
import { collectionArtworkGridTracks } from "@/components/custom/track-collection-utils";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { TintBackdrop } from "@/components/ui/tint-backdrop";
import { averageArtworkColors, useArtworkTint } from "@/lib/artwork-color";

const TINT_DEPTH = 0.3;

type Props = {
    songs: MusicItem[];
    isLoading: boolean;
    error?: unknown;
    anticipatedTrackCount?: number;
    onBackPress: () => void;
};

export default function QueryResults({
    songs,
    isLoading,
    error,
    anticipatedTrackCount,
    onBackPress,
}: Props) {
    const { width: screenWidth, height: screenHeight } = useWindowDimensions();
    const [saveOpen, setSaveOpen] = useState(false);
    const [saveName, setSaveName] = useState("");
    const [contentHeight, setContentHeight] = useState(screenHeight * 1.5);
    const tintTracks = useMemo(
        () => collectionArtworkGridTracks(songs),
        [songs],
    );
    const firstTint = useArtworkTint(tintTracks[0]).tint;
    const secondTint = useArtworkTint(tintTracks[1]).tint;
    const thirdTint = useArtworkTint(tintTracks[2]).tint;
    const fourthTint = useArtworkTint(tintTracks[3]).tint;
    const tint = useMemo(
        () =>
            averageArtworkColors([
                firstTint,
                secondTint,
                thirdTint,
                fourthTint,
            ]),
        [firstTint, fourthTint, secondTint, thirdTint],
    );
    const saveDialogWidth = Math.round(screenWidth * 0.75);
    const backSwipe = useMemo(
        () =>
            Gesture.Pan()
                .minDistance(8)
                .activeOffsetX(12)
                .failOffsetY([-24, 24])
                .onEnd((event) => {
                    if (event.translationX >= 64 || event.velocityX >= 650) {
                        runOnJS(onBackPress)();
                    }
                }),
        [onBackPress],
    );

    function closeSaveDialog() {
        setSaveOpen(false);
        setSaveName("");
    }

    function handleSaveOpenChange(open: boolean) {
        if (!open) setSaveName("");
        setSaveOpen(open);
    }

    function submitSave() {
        const name = saveName.trim();
        if (!name) return;
        console.info(
            `[QueryResults] Saving query "${name}" is not implemented yet.`,
        );
        closeSaveDialog();
    }

    return (
        <>
            <TrackCollectionView
                title="Matching Songs"
                tracks={songs}
                isLoading={isLoading}
                error={error}
                anticipatedTrackCount={anticipatedTrackCount}
                onBackPress={onBackPress}
                multiSelect={{ includeAddToQueue: true }}
                showTags
                containerStyle={tint ? { backgroundColor: tint } : undefined}
                background={
                    <TintBackdrop
                        tint={tint}
                        height={contentHeight}
                        depth={TINT_DEPTH}
                    />
                }
                onContentSizeChange={(_, height) =>
                    setContentHeight(Math.max(screenHeight, height))
                }
                options={[
                    {
                        id: "save-query",
                        label: "Save query",
                        icon: "bookmark-outline",
                        onPress: () => setSaveOpen(true),
                    },
                ]}
            />

            {Platform.OS === "ios" ? (
                <GestureDetector gesture={backSwipe}>
                    <View
                        className="absolute bottom-0 left-0 top-0 z-50 w-5"
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                    />
                </GestureDetector>
            ) : null}

            <Dialog open={saveOpen} onOpenChange={handleSaveOpenChange}>
                <DialogContent
                    style={{
                        width: saveDialogWidth,
                        minWidth: saveDialogWidth,
                        maxWidth: saveDialogWidth,
                        transform: [{ translateY: -96 }],
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>Save Query</DialogTitle>
                        <DialogDescription>
                            Give this query a name.
                        </DialogDescription>
                    </DialogHeader>
                    <View className="gap-1.5">
                        <Label>Query name</Label>
                        <Input
                            value={saveName}
                            onChangeText={setSaveName}
                            placeholder="e.g. Late night favorites"
                            autoFocus
                            returnKeyType="done"
                            onSubmitEditing={submitSave}
                        />
                    </View>
                    <View className="mt-1 flex-row gap-2.5">
                        <Button
                            variant="secondary"
                            className="flex-1"
                            onPress={closeSaveDialog}
                        >
                            <Text>Cancel</Text>
                        </Button>
                        <Button
                            className="flex-1"
                            disabled={!saveName.trim()}
                            onPress={submitSave}
                        >
                            <Text>Save</Text>
                        </Button>
                    </View>
                </DialogContent>
            </Dialog>
        </>
    );
}

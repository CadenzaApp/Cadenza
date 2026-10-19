import { useNavigation } from "expo-router";
import { useEffect, useRef, useState } from "react";
import type { ViewProps } from "react-native";
import type { QueryCondition, TagPlacement } from "../query-builder/types";

export function useTagPlacement(
    mode: "simple" | "advanced",
    conditions: QueryCondition[],
) {
    const navigation = useNavigation();
    const [pendingTag, setPendingTag] = useState<TagPlacement | null>(null);
    const placementTouchStart = useRef<{
        x: number;
        y: number;
        time: number;
        moved: boolean;
    } | null>(null);
    const activePendingTag =
        mode === "simple" &&
        pendingTag &&
        conditions.some((condition) =>
            pendingTag.conditionIds.includes(condition.id),
        )
            ? pendingTag
            : null;
    useEffect(
        () => navigation.addListener("blur", () => setPendingTag(null)),
        [navigation],
    );
    const placementTouches: Pick<
        ViewProps,
        "onTouchStart" | "onTouchMove" | "onTouchEnd" | "onTouchCancel"
    > = {
        onTouchStart: (event) => {
            const { pageX, pageY } = event.nativeEvent;
            placementTouchStart.current = {
                x: pageX,
                y: pageY,
                time: Date.now(),
                moved: false,
            };
        },
        onTouchMove: (event) => {
            const start = placementTouchStart.current;
            if (!start) return;
            const { pageX, pageY } = event.nativeEvent;
            if (
                Math.abs(pageX - start.x) >= 10 ||
                Math.abs(pageY - start.y) >= 10
            ) {
                start.moved = true;
            }
        },
        onTouchEnd: (event) => {
            const start = placementTouchStart.current;
            placementTouchStart.current = null;
            if (!activePendingTag || !start) return;
            const { pageX, pageY } = event.nativeEvent;
            if (
                !start.moved &&
                Math.abs(pageX - start.x) < 10 &&
                Math.abs(pageY - start.y) < 10 &&
                Date.now() - start.time < 700
            ) {
                setPendingTag(null);
            }
        },
        onTouchCancel: () => {
            placementTouchStart.current = null;
        },
    };
    return { activePendingTag, setPendingTag, placementTouches };
}

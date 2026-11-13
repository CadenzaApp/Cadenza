import { useLocalSearchParams, useRouter } from "expo-router";
import type { ReactNode } from "react";

import {
    SegmentedControl,
    type SegmentOption,
} from "@/components/ui/segmented-control";

/**
 * A category's switch between two views of it, like Your playlists and Shared
 * playlists. The pick lives in the `view` param, so a link can open on either
 * (a profile's See all opens on shared). The first option is the default.
 * Returns the pick and the switch, for the caller to put at the top of its
 * list.
 */
export function useLibraryViewSwitch<T extends string>(
    options: readonly SegmentOption<T>[],
): { view: T; viewSwitch: ReactNode } {
    const router = useRouter();
    const params = useLocalSearchParams<{ view?: string }>();
    const view =
        options.find((option) => option.value === params.view)?.value ??
        options[0].value;
    return {
        view,
        viewSwitch: (
            <SegmentedControl
                size="sm"
                options={options}
                value={view}
                onChange={(next) => router.setParams({ view: next })}
            />
        ),
    };
}

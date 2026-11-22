import { useLocalSearchParams, useRouter } from "expo-router";
import type { ReactNode } from "react";

import {
    SlidingTabPager,
    type SlidingTabOption,
} from "@/components/ui/sliding-tab-pager";
import { useTopRailInset } from "@/lib/top-rail";

/** Library tabs keep the selected page in `view`, including profile deep links. */
export function LibraryViewPager<T extends string>({
    options,
    renderPage,
}: {
    options: readonly SlidingTabOption<T>[];
    renderPage: (view: T) => ReactNode;
}) {
    const router = useRouter();
    const params = useLocalSearchParams<{ view?: string }>();
    const view =
        options.find((option) => option.value === params.view)?.value ??
        options[0].value;
    const topInset = useTopRailInset() ?? 0;
    return (
        <SlidingTabPager
            options={options}
            value={view}
            onChange={(next) => router.setParams({ view: next })}
            renderPage={renderPage}
            topInset={topInset}
        />
    );
}

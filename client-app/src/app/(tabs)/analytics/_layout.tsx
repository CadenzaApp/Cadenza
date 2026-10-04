import { TabStack } from "@/components/custom/tab-stack";
import { AnalyticsPeriodProvider } from "@/features/analytics/analytics-period";

/**
 * The provider wraps the stack, not a screen, so the selected period survives
 * navigating into a detail page and back.
 */
/**
 * The detail pages pin the period bar above their list, so their rail stays
 * put. The overview scrolls as one page, so its rail floats.
 */
const PINNED_RAIL = ["[dimension]", "songs", "tags"];

export default function AnalyticsLayout() {
    return (
        <AnalyticsPeriodProvider>
            <TabStack title="Analytics" pinnedRail={PINNED_RAIL} />
        </AnalyticsPeriodProvider>
    );
}

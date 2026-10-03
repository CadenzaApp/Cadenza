import { TabStack } from "@/components/custom/tab-stack";
import { AnalyticsRangeProvider } from "@/features/analytics/analytics-range";

/**
 * The provider wraps the stack, not a screen, so the selected time range
 * survives navigating into a detail page and back.
 */
export default function AnalyticsLayout() {
    return (
        <AnalyticsRangeProvider>
            <TabStack title="Analytics" />
        </AnalyticsRangeProvider>
    );
}

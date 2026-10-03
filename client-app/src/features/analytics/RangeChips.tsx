import { useAnalyticsRange } from "./analytics-range";
import { ChipRow } from "./ChipRow";
import { ANALYTICS_RANGES, rangeLabel } from "./range";

/**
 * The time range filter. Every page on the tab shows it, and they all read the
 * same provider, so changing it on one page changes it everywhere.
 */
export function RangeChips() {
    const { range, setRange } = useAnalyticsRange();
    return (
        <ChipRow
            options={ANALYTICS_RANGES}
            selected={range}
            onSelect={setRange}
            labelOf={rangeLabel}
        />
    );
}

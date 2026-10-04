import { Skeleton } from "@/components/ui/skeleton";
import { useAnalyticsTopTags, type TagPlayCount } from "@/lib/routes/analytics";

import { useAnalyticsPeriod } from "./analytics-period";
import { AnalyticsScrollScreen } from "./AnalyticsScrollScreen";
import { TopTagList } from "./TopTagList";

/**
 * The tags the user listens to over the selected period, by plays of the songs
 * carrying them.
 *
 * A play count, not the decaying interest score that used to sit in Account
 * settings, so it answers "what did I listen to this month" and moves with the
 * period.
 */
export function TopTagsScreen() {
    const { period } = useAnalyticsPeriod();
    const { topTags, topTagsLoading, topTagsErr } = useAnalyticsTopTags({
        since: period.since,
        until: period.until,
    });

    return (
        <AnalyticsScrollScreen
            title="Tags"
            error={topTagsErr}
            errorLabel="Could not load your tags."
            loading={topTagsLoading && !topTags}
            skeleton={<Skeleton className="h-24 w-full rounded" />}
        >
            <TopTagList
                tags={topTags?.entries ?? NO_TAGS}
                emptyLabel="Tag some songs and play them to see this."
            />
        </AnalyticsScrollScreen>
    );
}

/** Stable, so a pending read does not give the list a new array each render. */
const NO_TAGS: TagPlayCount[] = [];

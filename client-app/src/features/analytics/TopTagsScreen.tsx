import { Skeleton } from "@/components/ui/skeleton";
import { useAnalyticsTopTags, type TagPlayCount } from "@/lib/routes/analytics";

import { useAnalyticsRange } from "./analytics-range";
import { AnalyticsScrollScreen } from "./AnalyticsScrollScreen";
import { TopTagList } from "./TopTagList";

/**
 * The tags the user listens to over the selected range, by plays of the songs
 * carrying them.
 *
 * A play count, not the decaying interest score that used to sit in Account
 * settings, so it answers "what did I listen to this month" and moves with the
 * range filter.
 */
export function TopTagsScreen() {
    const { resolved } = useAnalyticsRange();
    const { topTags, topTagsLoading, topTagsErr } = useAnalyticsTopTags({
        since: resolved.since,
        until: resolved.until,
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

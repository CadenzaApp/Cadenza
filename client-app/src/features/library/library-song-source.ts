import type { QueryJSON } from "@/lib/query-json";
import type { ArrangeSource } from "@/lib/routes/arrange";

/** Apple owns the plain library-only list; the backend handles widened scopes. */
export function librarySongSource(
    showAllTagged: boolean,
    arranged: boolean,
    term: string | null,
): ArrangeSource | null {
    if (!showAllTagged && (!arranged || term !== null)) return null;
    const query: QueryJSON = {
        where: term
            ? {
                  or: (["title", "artist", "album"] as const).map((key) => ({
                      filter: {
                          field: "metadata",
                          key,
                          op: "contains",
                          value: term,
                      },
                  })),
              }
            : { and: [] },
    };
    return {
        kind: "query",
        query,
        considerDefaultTags: false,
        scope: showAllTagged ? "libraryOrTagged" : "library",
    };
}

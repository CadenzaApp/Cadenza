import ExpoModulesCore

/// Anything carrying one page's `limit` and `offset`.
///
/// The clamp lives here rather than in each function so every paged read asks
/// Apple for a page it will actually accept.
protocol PagedOptions {
    var limit: Int { get }
    var offset: Int { get }
}

extension PagedOptions {
    /// `limit` inside what Apple accepts, and a non-negative `offset`.
    func clamped(maxLimit: Int = 100) -> (limit: Int, offset: Int) {
        (min(maxLimit, max(1, limit)), max(0, offset))
    }
}

/// The `{ limit, offset }` every paged read takes.
///
/// Declared as a `Record` so ExpoModulesCore converts and validates the object
/// coming off the bridge. Reading the values out of a `[String: Any]` by hand
/// does not work: Expo hands a JS number over as a `Double`, so `as? Int` misses
/// and the read silently falls back to its default instead of failing.
struct PageOptions: Record, PagedOptions {
    @Field var limit: Int = 50
    @Field var offset: Int = 0
}

/// How `getLibrarySongs` orders its pages. iOS only; the REST reads the other
/// platform uses cannot sort.
struct LibrarySortOptions: Record {
    /// `title`, `artist`, `album`, or `dateAdded`. Anything else is unsorted.
    @Field var option: String?
    /// `descending`, or ascending for anything else.
    @Field var direction: String?
}

/// `PageOptions` plus the sort only library songs accept.
struct LibrarySongOptions: Record, PagedOptions {
    @Field var limit: Int = 50
    @Field var offset: Int = 0
    @Field var sort: LibrarySortOptions?
}

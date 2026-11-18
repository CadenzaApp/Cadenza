# analytics

The Analytics tab: what the user's listening looks like over one calendar period, from the
backend's event log.

Six screens behind five routes: an overview, one dynamic `[dimension]` route serving every
ranking, a playable songs list, tags, and the songs listened to in one heatmap hour. `src/app/(tabs)/(analytics)/analytics/` only re-exports them.
Everything here is presentation: no number on this tab is computed in the client, the backend
aggregates in SQL and this formats and lays out what comes back.

Adding a dimension is one entry in `dimensions.ts` and one in the backend's `Dimension::ALL`. The
overview's shelves, the detail route and each row's href all read that list.

## The ranking shelves

One shelf per dimension, in `DIMENSIONS` order: songs, artists, albums, playlists, queries, shared
playlists, live sessions. Each is a heading with "See all", which opens the full list, then the
top five from the summary as a peeking carousel of tiles. A dimension with nothing this period has
no shelf. A song row plays the ranking from that row; every
other row opens its page: a playlist, album, artist, or shared playlist screen, a query's results
run again, and a live session row, which is every session one host ran, opens the host's profile. Playlists, queries,
shared playlists and sessions rank off the source a play was started from; see Listening events
in `src/lib/README.md`.

## The overview

Top to bottom: header, #1 hero, stats strip, heatmap, the tags shelf, then the ranking shelves. Every section sits on an `AnalyticsCard` (liquid glass), over a nebula (`NebulaBackdrop`) in
no two alike: the top five tags' colors, then the hero covers' colors to fill in for tags that
share one (`distinctColors`), and only then repeats. The nebula is fixed to the screen and the
page scrolls over it.

The overview's rail floats with no background, so the nebula shows through it. The detail pages pin
it, since their period bar sits fixed above the list. Every page pads the bottom by
`contentBottomInset`, which clears the tab bar and player itself.

## Files

| file                          | role                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AnalyticsOverviewScreen.tsx` | The overview shell, the page tint, and `OverviewBody`, which lays the sections out in order.                                                                                          |
| `AnalyticsScrollScreen.tsx`   | The shell the detail pages share: the period bar pinned above a scroll view, plus the error and loading states.                                                                       |
| `TopSongsScreen.tsx`          | The full most played songs list, as a playable `MusicList`. Not the shared shell, because a `MusicList` cannot nest in a scroll view.                                                 |
| `TopEntityScreen.tsx`         | Any full ranking but songs. Serves every dimension off its descriptor, so it is the whole of `analytics/[dimension]`.                                                                 |
| `TopTagsScreen.tsx`           | The full tag ranking.                                                                                                                                                                 |
| `range.ts`                    | Pure: a grain and an offset to the period's window, buckets, heatmap shape and labels. Tested in `range.test.ts`.                                                                     |
| `analytics-period.tsx`        | `AnalyticsPeriodProvider` and `useAnalyticsPeriod`: the period every screen shares.                                                                                                   |
| `PeriodControls.tsx`          | `GrainPicker`, `PeriodStepper`, and `PeriodBar`, the one-row version the detail pages use.                                                                                            |
| `AnalyticsHeader.tsx`         | The overview's header: period, dates, grain, arrows, and when it last updated.                                                                                                        |
| `analytics-hooks.ts`          | `usePageTint`, `useNebulaColors` and `useUpdatedAgo`.                                                                                                                                 |
| `AnalyticsCard.tsx`           | The glass card every section sits on.                                                                                                                                                 |
| `SectionHeading.tsx`          | A section title, an optional line under it, and an optional "See all".                                                                                                                |
| `HeroCarousel.tsx`            | The period's top three songs as a fan of covers. Swipe or tap to pick one; Play starts the top songs from it.                                                                         |
| `StatsStrip.tsx`              | A few headline numbers with icons on one card. Takes its stats as data.                                                                                                               |
| `Heatmap.tsx`                 | When the user listens, by listening time. Tap to pick, again to let go, double tap or "Open" to go one grain down, back arrow up. At a day, the button opens the picked hour's songs. |
| `TagCarousel.tsx`             | The span's tags as a drifting row under the grid, and the heatmap's tag filter. A tapped tag fades out of the row; `TagShareChip` draws it.                                           |
| `HeatmapGrid.tsx`             | Draws the fixed calendar or seven additive daily duration bars, with one accent.                                                                                                      |
| `HeatmapDetail.tsx`           | The shown span in two lines: time listened and plays, or the tag's time and share when filtered.                                                                                      |
| `ListenedSongsScreen.tsx`     | The songs listened to in one span, as a playable `MusicList` page. Opened from the heatmap's hour; loading more raises the read's limit.                                              |
| `tag-share.ts`                | Pure: a tag's share of listening time, and the `TagFilter` type. Tested in `tag-share.test.ts`.                                                                                       |
| `heatmap-layout.ts`           | Pure: a heatmap shape to a grid of keyed cells, what each cell picks, and `heatLevel`. Tested in `heatmap-layout.test.ts`.                                                            |
| `TagRotation.tsx`             | The top shelf: the tags played this period, top five as `ShelfTile`s drawing the tilted tag pill in place of art, then See all. Each opens its tag.                                   |
| `ShelfTile.tsx`               | The tile every shelf draws: square art with the rank, then title, subtitle and plays under it.                                                                                        |
| `dimensions.ts`               | Pure: one descriptor per dimension, and where each one's rows go. Tested in `dimensions.test.ts`.                                                                                     |
| `TopShelves.tsx`              | The overview's ranking shelves, one peeking carousel of tiles per dimension.                                                                                                          |
| `use-ranked-rows.ts`          | `useRankedRows`: a ranking's entries as rows with artwork and what a tap does. The shelves and `TopEntityList` both draw from it.                                                     |
| `TopEntityList.tsx`           | The full ranking as rows with artwork and a play count. A song row plays, any other opens its page.                                                                                   |
| `TopTagList.tsx`              | The tag ranking as `TagPill`s, for the full tags page.                                                                                                                                |
| `format.ts`                   | Durations, percents, counts, hours, bucket labels, "updated ago", and `formatMetric`. Pure, tested in `format.test.ts`.                                                               |

## The period owns everything

One period drives every read on the tab. It is a grain plus how many of them back from now, so
offset 0 always follows the clock. Weeks start Monday. Every bound is local midnight.

| Grain | Window             | Heatmap                         |
| ----- | ------------------ | ------------------------------- |
| Day   | midnight to next   | hour cells, four rows of six    |
| Week  | Monday to Monday   | one duration bar per day        |
| Month | the 1st to the 1st | day cells, as a calendar        |
| Year  | Jan 1 to Jan 1     | month cells, four rows of three |

Changing the grain jumps back to the current period. Forward is disabled on the current period.
There is no all time grain; other years are a step back on Year.

`AnalyticsPeriodProvider` is mounted in the tab's `_layout`, above the stack, so the period
survives navigating into a detail page and back.

## Gotchas

- **`now` in the provider is state, not a ref or a fresh `new Date()` per render.** The window is
  part of the SWR key, so a clock that moves every render misses the cache every render. It is
  refreshed on a period change and on `AppState` becoming active, so an app left open overnight
  does not keep yesterday as "today".
- **Heatmap cells are keyed by the backend's local bucket start**, `YYYY-MM-DD` or
  `YYYY-MM-DDTHH:00`. `heatmap-layout.ts` builds the same strings from local dates by hand. Going
  through `toISOString` would shift them into UTC and miss every cell.
- **The heatmap drills down in place.** Nothing is picked at first, so the detail reads out the
  whole level. A tap picks a span and the detail reads it out from a summary read of that span;
  a second tap lets go. A double tap or "Open" opens the span one grain down: a year's month, a month's day opens its week, a week's day. The card holds a stack of
  levels over the page's period, each with its pick, and fetches its own heatmap for the top
  one, so back never goes above the page's period. A future span does not open. The
  card never changes size: every part has a fixed height and every level fills one grid box
  sized off the card's width. A level that is loading shows a skeleton, never the last level's
  cells: the heatmap read does not keep previous data. A tap on Open while a level slides in is
  dropped.
- **The week shows one duration bar per day.** Each bar selects its whole day. Values and the peak label describe the bar scale; opening the day shows all 24 hours. The month always reserves six calendar rows.
- **A tag's share is of listening time, and shares overlap.** `/analytics/tag-shares` counts each
  listen in full toward every tag on its song, never split, so the carousel's percents can sum past
  100%. Only the user's own tags come back, never activity or suggested ones.
- **The carousel is the tag filter.** Selecting a tag recolors the grid and legend in the tag's
  color, fades it out of the row, and fades it in across from the detail's date, where a tap lets it
  go. It sits outside `HeatmapDetail`, which remounts per span, so picking a square never refades it.
  The row lists the picked span's tags, or the level's with nothing picked, unfiltered. The read keeps
  the last span's tags while the next loads and the row stays mounted, so tapping around swaps chips
  in place. A tag let go joins the back of the row only once the back has drifted off screen, so
  nothing visible shifts. The selection lives above the card and survives period changes; a span
  without the tag still shows it, at zero, never another tag.
- **Calendar and detail use `/analytics/listening`.** Its `total_ms` is unfiltered; `listening_ms`,
  plays and cells match the pinned tag, so the filtered detail shows the tag's share of all time.
- **Songs open per hour, from a day.** The button stays disabled until an hour is picked, then
  pushes `/analytics/listened` with the hour's bounds, title and tag as plain params. It reads
  `/analytics/session-songs` with no session key. A full page, not a sheet, so the songs can be
  played, queued and navigated from like any other list.
  The backend's session endpoints stay, but nothing on the card reads them for now.
- **Listens and listening time can disagree.** A listen counts as a play at 15 seconds but only
  gets its time when it ends, and only for time the app watched, so a span can have plays and no
  time. The detail then reads `0m` next to its plays.
- **The listening calendar is sparse.** Only buckets with time or counted plays come back. Untimed plays are retained in the counts but do not imply recorded duration. Future cells are dimmed and disabled. New period/filter reads do not hold the previous period's data under new labels; saved reads and errors stay scoped to their complete key.
- **The hero and the heatmap are keyed by period** in `OverviewBody`, so a new period starts back
  on #1 with nothing selected, without an effect resetting state.
- **"Updated" is the last fetch that landed**, from the summary read's `onSuccess`. A cache hit
  does not move it.
- **The nebula is fixed to the screen**, behind the scroller, so the page and its overscroll
  slide over it.
- **Offline, the page keeps what it had.** Every analytics read saves its last good response on
  the device, and a screen shows data over an error whenever it has any. The header then says
  "Offline" in place of "Updated". The error state is only for a period never loaded on this
  device.
- **`MusicList` owns its own list and cannot go inside a `ScrollView`.** That is why the songs page
  is its own screen with the period bar above it, and why the scrolling pages use `TopEntityList`.
- **A row opens and shows its own resource.** The descriptor's `own` names the kind (album,
  playlist, artist). Its id is the one a play recorded, else an exact name match from a catalog
  search, else the sample song's. Plays on iOS record no artist id and few album ids, so the
  search is what makes those rows tappable, and a sample song can sit on several albums, which is
  why it comes last. The picture comes from that id; with none, the sample song's cover.
  Queries and shared playlists always show a song's cover, and a live session row its host's
  initials. Tags show no art: the
  tag itself, tilted across its color.
- **Each dimension picks its own second line** (`subtitleFor`): a song's or album's artist, a
  playlist's curator or your name for one in your library, a shared playlist's owner from the backend,
  and nothing for artists, queries and live sessions (titled `<host>'s session`). Never the sample song's artist.
- **`useTracksForSongIds` drops ids it cannot resolve**, so an unavailable song falls out of the
  songs page rather than listing without a title. `TopEntityList` keeps the row and falls back to
  the key.
- **A row with no recorded entity id renders inert.** Library-only plays carry no catalog id, so
  there is nothing to open; the descriptor's `hrefFor` returns null and the row does not navigate.
- **A period with no plays gets a message**, keyed on `stats.plays === 0`, because a page of zeros
  reads as broken. The header stays, so the user can step to a period that has some.

# analytics

The Analytics tab: what the user's listening looks like over one calendar period, from the
backend's event log.

Five screens behind four routes: an overview, one dynamic `[dimension]` route serving every
ranking, a playable songs list, and tags. `src/app/(tabs)/analytics/` only re-exports them.
Everything here is presentation: no number on this tab is computed in the client, the backend
aggregates in SQL and this formats and lays out what comes back.

Adding a dimension is one entry in `dimensions.ts` and one in the backend's `Dimension::ALL`. The
rankings card's picker, the detail route and each row's href all read that list.

## The rankings card

One card for songs, playlists, albums, artists and queries. A small tab bar across its top picks
which, songs by default. It shows the top five from the summary and "See all" opens the full list. A song row plays the
ranking from that row; every other row opens its page: a playlist, album or artist screen, or a
query's results run again. Playlists and queries rank off the source a play was started from; see
Listening events in `src/lib/README.md`.

## The overview

Top to bottom: header, #1 hero, stats strip, heatmap, tag rail, then the trend chart, the
rankings card, and on repeat. Every section sits on an `AnalyticsCard` (liquid glass), over a nebula (`NebulaBackdrop`) in
no two alike: the top five tags' colors, then the hero covers' colors to fill in for tags that
share one (`distinctColors`), and only then repeats. The nebula is fixed to the screen and the
page scrolls over it.

The overview's rail floats with no background, so the nebula shows through it. The detail pages pin
it, since their period bar sits fixed above the list. Every page pads the bottom by
`contentBottomInset`, which clears the tab bar and player itself.

## Files

| file                          | role                                                                                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AnalyticsOverviewScreen.tsx` | The overview shell, the page tint, and `OverviewBody`, which lays the sections out in order.                                                                                                                      |
| `AnalyticsScrollScreen.tsx`   | The shell the detail pages share: the period bar pinned above a scroll view, plus the error and loading states.                                                                                                   |
| `TopSongsScreen.tsx`          | The full most played songs list, as a playable `MusicList`. Not the shared shell, because a `MusicList` cannot nest in a scroll view.                                                                             |
| `TopEntityScreen.tsx`         | Any full ranking but songs. Serves every dimension off its descriptor, so it is the whole of `analytics/[dimension]`.                                                                                             |
| `TopTagsScreen.tsx`           | The full tag ranking.                                                                                                                                                                                             |
| `range.ts`                    | Pure: a grain and an offset to the period's window, buckets, heatmap shape and labels. Tested in `range.test.ts`.                                                                                                 |
| `analytics-period.tsx`        | `AnalyticsPeriodProvider` and `useAnalyticsPeriod`: the period every screen shares.                                                                                                                               |
| `PeriodControls.tsx`          | `GrainPicker`, `PeriodStepper`, and `PeriodBar`, the one-row version the detail pages use.                                                                                                                        |
| `AnalyticsHeader.tsx`         | The overview's header: period, dates, grain, arrows, and when it last updated.                                                                                                                                    |
| `analytics-hooks.ts`          | `usePageTint`, `useNebulaColors` and `useUpdatedAgo`.                                                                                                                                                             |
| `AnalyticsCard.tsx`           | The glass card every section sits on.                                                                                                                                                                             |
| `SectionHeading.tsx`          | A section title, an optional line under it, and an optional "See all".                                                                                                                                            |
| `HeroCarousel.tsx`            | The period's top three songs as a fan of covers. Swipe or tap to pick one; Play starts the top songs from it.                                                                                                     |
| `StatsStrip.tsx`              | A few headline numbers with icons on one card. Takes its stats as data.                                                                                                                                           |
| `Heatmap.tsx`                 | When the user listens, colored by tag. Draws what `heatmap-layout.ts` lays out.                                                                                                                                   |
| `heatmap-layout.ts`           | Pure: a heatmap shape to a grid of keyed cells, and `heatLevel`. Tested in `heatmap-layout.test.ts`.                                                                                                              |
| `TagRotation.tsx`             | The tags played this period as a sideways rail of square tiles. Each opens its tag.                                                                                                                               |
| `dimensions.ts`               | Pure: one descriptor per dimension, and where each one's rows go. Tested in `dimensions.test.ts`.                                                                                                                 |
| `ChipRow.tsx`                 | One row of selectable chips, for the trend chart's metric picker.                                                                                                                                                 |
| `TrendChart.tsx`              | One metric over the period, as bars, with the headline metric picker.                                                                                                                                             |
| `HoursChart.tsx`              | Plays across the hours of the local day. What a day shows instead of a trend.                                                                                                                                     |
| `BarChart.tsx`                | One series over an ordered axis, Screen Time style: a headline with the total (or the tapped bar), bars spread across the full width in equal slots, a rounded value axis (`axisCeiling`) and free placed labels. |
| `TopRankingsCard.tsx`         | The overview's one card for every ranking, with the dimension picker.                                                                                                                                             |
| `SegmentedBar.tsx`            | A small tab bar of icon and label segments with a sliding pill. The rankings card's picker.                                                                                                                       |
| `TopEntityList.tsx`           | Ranked rows with artwork and a play count. A song row plays, any other opens its page.                                                                                                                            |
| `TopTagList.tsx`              | The tag ranking as `TagPill`s, for the full tags page.                                                                                                                                                            |
| `format.ts`                   | Durations, percents, counts, hours, bucket labels, "updated ago", and `formatMetric`. Pure, tested in `format.test.ts`.                                                                                           |

## The period owns everything

One period drives every read on the tab. It is a grain plus how many of them back from now, so
offset 0 always follows the clock. Weeks start Monday. Every bound is local midnight.

| Grain | Window             | Chart         | Heatmap                            |
| ----- | ------------------ | ------------- | ---------------------------------- |
| Day   | midnight to next   | 24 hour bars  | hour cells, two rows of twelve     |
| Week  | Monday to Monday   | 7 day bars    | two hour cells, weekdays by twelve |
| Month | the 1st to the 1st | day bars      | day cells, as a calendar           |
| Year  | Jan 1 to Jan 1     | 12 month bars | day cells, as a contribution grid  |
| All   | the whole history  | `bucket=auto` | month cells, one row per year      |

Changing the grain jumps back to the current period. Forward is disabled on the current period,
and All has no arrows.

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
- **The heatmap is sparse.** Only buckets with a play come back; the layout decides the grid and
  every other square draws empty. A square's color is its most played tag, gray when nothing in it
  was tagged, and brightness is a square root step of plays over the period's peak.
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
- **Artwork comes from `sample_song_id`.** One `useTracksForSongIds` call per section resolves
  every row. For an album that is the album cover; for an artist or a tag it is the cover of one
  of its songs. A playlist row fetches its own cover by id (`artworkCollection` on the descriptor)
  and only falls back to the song's when the playlist has none.
- **`useTracksForSongIds` drops ids it cannot resolve**, so an unavailable song falls out of the
  songs page rather than listing without a title. `TopEntityList` keeps the row and falls back to
  the key, and a tag tile falls back to a gradient of the tag's color.
- **Bucket labels come off `trend.bucket`**, the bucket the response was computed with, not the
  selected period. `keepPreviousData` holds the old series while a new request is in flight.
- **A row with no recorded entity id renders inert.** Library-only plays carry no catalog id, so
  there is nothing to open; the descriptor's `hrefFor` returns null and the row does not navigate.
- **`format.ts` parses `YYYY-MM-DD` by hand** rather than with `new Date()`, which would read a
  bare date as UTC midnight and print it a day early west of Greenwich.
- **A period with no plays gets a message**, keyed on `stats.plays === 0`, because a page of zeros
  reads as broken. The header stays, so the user can step to a period that has some.
- **A trend's values are formatted by the `unit` the response carries**, not by the metric's name.
- **Bars and their axis labels share one width cap.** Capping only the bars left the labels
  spreading the full plot while the bars sat left, so every label named the wrong bar.

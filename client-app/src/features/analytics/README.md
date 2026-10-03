# analytics

The Analytics tab: what the user's listening looks like, from the backend's event log.

Five screens. `src/app/(tabs)/analytics/` only re-exports them. Everything here is presentation:
no number on this tab is computed in the client, the backend aggregates in SQL and this formats
and lays out what comes back.

## Files

| file                          | role                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `AnalyticsOverviewScreen.tsx` | Stat tiles, the chart, and a top-5 preview card per dimension with a "See all".             |
| `TopSongsScreen.tsx`          | The full most played songs list, as a playable `MusicList`.                                 |
| `TopEntityScreen.tsx`         | The full artists or albums ranking. One component, parameterized by dimension.              |
| `TopTagsScreen.tsx`           | The full tag ranking.                                                                       |
| `analytics-range.tsx`         | `AnalyticsRangeProvider` and `useAnalyticsRange`: the time range every screen shares.       |
| `range.ts`                    | Pure: a range to its window and bucket. Tested in `range.test.ts`.                          |
| `entity-routes.ts`            | Pure: where an artist or album row goes, or null. Tested in `entity-routes.test.ts`.        |
| `RangeChips.tsx`              | The range filter, bound to the provider.                                                    |
| `ChipRow.tsx`                 | One row of selectable chips. Used by the range filter and the metric picker.                |
| `TopEntityList.tsx`           | Ranked rows with artwork and a play count, for the previews and the artist and album pages. |
| `TopTagList.tsx`              | The tag ranking as `TagPill`s.                                                              |
| `BarChart.tsx`                | A single series of counts over an ordered axis. Tap a bar for its value.                    |
| `StatTile.tsx`                | One number with its name, for the counts that are a headline rather than a chart.           |
| `format.ts`                   | Durations, percents, counts, hours, and bucket labels. Pure, tested in `format.test.ts`.    |

## The range owns the bucket

This is the important idea on the tab. One filter drives every read, and each range picks the
bucket that gives its chart a readable number of bars:

| Range | Window                       | Chart                       |
| ----- | ---------------------------- | --------------------------- |
| Today | local midnight to the next   | 24 hour bars                |
| Week  | last 7 local days            | 7 day bars                  |
| Month | last 30 local days           | 30 day bars                 |
| Year  | last 12 months, from the 1st | 12 month bars               |
| All   | the user's whole history     | `bucket=auto`, server picks |

Before this, the chart ran from the first event to the last at weekly buckets, so anyone with
under a week of history saw exactly one bar.

`AnalyticsRangeProvider` is mounted in the tab's `_layout`, above the stack, so the range survives
navigating into a detail page and back.

## Gotchas

- **`now` in the provider is state, not a ref or a fresh `new Date()` per render.** The window is
  part of the SWR key, so a clock that moves every render misses the cache every render. It is
  refreshed on a range change and on `AppState` becoming active, so an app left open overnight
  does not keep yesterday's "Today".
- **`MusicList` owns its own list and cannot go inside a `ScrollView`.** That is why the songs page
  is its own screen with the filter above it, and why the scrolling overview and the artist and
  album pages use `TopEntityList` instead.
- **Row artwork comes from `sample_song_id`.** One `useTracksForSongIds` call resolves every row on
  a card. For an album that is exactly the album cover; for an artist it is a cover of one of
  their songs, not a portrait. A portrait would need one `useArtist` per row, and there is no
  batch artist fetch.
- **`useTracksForSongIds` drops ids it cannot resolve**, so an unavailable song falls out of the
  songs page rather than listing without a title. `TopEntityList` keeps the row and falls back to
  the key, since it does not need a `MusicItem`.
- **Bars are width-capped and start-aligned.** Without the cap a short series stretches to fill the
  plot, which is the other half of the one-bar complaint.
- **Bucket labels come off `trend.bucket`**, the bucket the response was computed with, not the
  selected range. `keepPreviousData` holds the old series while a new request is in flight, and
  labelling that with the new range would relabel a monthly series as days.
- **A row with no recorded entity id renders inert.** Library-only plays carry no catalog id, so
  there is nothing to open; `entity-routes.ts` returns null and the row does not navigate.
- **`format.ts` parses `YYYY-MM-DD` by hand** rather than with `new Date()`, which would read a
  bare date as UTC midnight and print it a day early west of Greenwich. The bucket is already local.
- **A new account gets its own empty state**, keyed on `stats.plays === 0`, because a page of zeros
  reads as broken.
- The overview's metric picker offers three metrics, not the backend's eight. The rest are still
  served by `GET /analytics/metrics`.

# analytics

The Analytics tab: what the user's listening looks like, from the backend's event log.

`src/app/(tabs)/analytics/index.tsx` only re-exports `AnalyticsScreen`. Everything here is
presentation. No number on this screen is computed in the client; the backend aggregates in SQL
and this formats and lays out what comes back.

## Files

| file                  | role                                                                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AnalyticsScreen.tsx` | The screen. Reads `useAnalyticsSummary`, `useAnalyticsTrend`, and `useAnalyticsMetrics`, and owns the selected metric and bucket. Holds the loading, error, and empty states. |
| `BarChart.tsx`        | A single series of counts over an ordered axis. Tap a bar for its value.                                                                                                      |
| `StatTile.tsx`        | One number with its name, for the counts that are a headline rather than a chart.                                                                                             |
| `SongPlayList.tsx`    | A ranked list of songs with a figure each. Resolves song ids to titles through `useTracksForSongIds`.                                                                         |
| `format.ts`           | Durations, percents, counts, hours, bucket labels, and which bucket labels to show. Pure, tested in `format.test.ts`.                                                         |

## How it reads

`GET /analytics/summary` fills the tiles and the lists in one request. `GET /analytics/trends` is a
second request per selected metric and bucket; its SWR key covers both, so switching either reads
its own cache entry rather than showing the previous series. The metric chips come from
`GET /analytics/metrics`, so a metric added to the backend registry shows up here with no change in
this directory.

Every request sends the device's IANA timezone. Day, week, and hour boundaries are cut in it, since
a UTC week is the wrong week for most users.

## Charts

One series per chart, so one colour and no legend: the card title names what it is. The mark is
`chart-2` from the project's sequential ramp in `global.css`, which clears 3:1 against both the
light and dark card surfaces.

Trend buckets arrive dense from the backend, so an empty bucket is a real zero and draws a hairline
rather than going missing. Axis labels are thinned to at most five, always including both ends, so
they cannot collide. A tap reads the value out above the plot, which holds its height so selecting
a bar does not shift the layout.

## Gotchas

- A new account gets its own empty state, not a page of zeros, because a wall of zeros reads as
  broken. The check is `stats.plays === 0`.
- `plays_by_hour` is always 24 entries. Do not filter it to the hours with plays; the empty hours
  are the shape.
- `top_songs` and `most_replayed` come back as song ids. Apple Music owns the titles, so a song
  whose metadata will not load lists by id rather than dropping out of a ranking it earned.
- `formatBucket` parses `YYYY-MM-DD` by hand rather than with `new Date()`, which would read a bare
  date as UTC midnight and print it a day early west of Greenwich. The bucket is already local.
- Rates come from the backend's `rates` object, not from dividing the counts here. A ratio of sums
  is not the average of ratios, and the backend already made that choice.
- Bucket labels come off `trend.bucket`, the bucket the response was computed with, not the
  selected chip. `keepPreviousData` holds the old series while a new request is in flight or has
  failed, and labelling that with the chip would relabel a weekly series as days.
- The metric chips come from the backend, which only lists metrics something emits events for. A
  metric with no emitter would be a chart that only ever shows zeros.

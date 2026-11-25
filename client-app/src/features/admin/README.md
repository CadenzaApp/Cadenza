# Admin

A full-screen modal opened from Account for Owners and Admins. Moderators have no
admin screen or powers yet. The backend checks membership on every privileged request.

- `AdminScreen.tsx` owns section selection, filters, pinned period controls, and
  the floating nav overlay. Content reaches the screen edge; measured nav height
  supplies bottom scroll padding. Plot touches lock vertical scrolling and paging.
- `AdminCharts.tsx` contains charts, swipe/dot paging, and the ending breakdown.
  Touching a plot scrubs immediately; swipe above/below it to change charts.
  Future days reserve space without zero values. Scrubbing updates endings locally.
- `AdminRankings.tsx` owns catalog hydration and rows. Song pills move beside content
  only when measured widths fit; artist/tag pills stay below. Post rows use PostCard.
- `RoleControls.tsx` uses backend-provided role choices and confirms access changes.
  It sends the role the user saw as `expected_role`, so stale confirmations fail safely.
- `admin-utils.ts` holds pure date, chart, ending, and OKLab palette helpers.
  `admin-ui.tsx` holds the shared presentation pieces and scroll-lock context.

Reads use SWR without persistent device saves. Revocation hides privileged data and
clears cached admin reads. API shapes/hooks live in `lib/routes/admin.ts`. Calendar
controls reuse Analytics, converted to UTC calendar dates for the API. Users offers
week/month, Social week/month/year. Weeks start Monday.

Snapshots are immutable as of their cutoff, so late events may make rankings and
frozen totals differ. DAU/WAU/MAU are independent distinct-user counts. Engaged days
is average DAU / WAU-or-MAU times elapsed days, without projecting an unfinished period.
Plays and recorded time sum daily snapshots plus live incomplete days. Listening
only covers playback observed by the app. Tags reflect current membership; shares
overlap. Artist duration is omitted because ending events often lack artist metadata.

Admin navigation uses the player's actual masked icons, stretching pill, and shell.
Its inactive icons use the admin-specific black/white color override. The nebula
preserves the accent and its 30/70 percent OKLab blends without artwork normalization.

Run TypeScript, ESLint, and `npm test` in `client-app`. Database regressions and the
schema order are documented in `backend-api/README.md`. Verify layout and gestures
on a real device; do not launch a simulator unless requested.

# cadenza

The boolean-query workspace rendered by the Cadenza tab. It owns the tag request and the query
state, so an in-progress mix survives switching tabs.

Tags used to share this screen behind a Query / Tags segmented control. They are a library
category now, opened from the library screen, so this tab is only the query builder. See
[../library/README.md](../library/README.md).

## Files

| file                | role                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| `CadenzaScreen.tsx` | The query builder, tag data, query state, live preview, and results-route launch. |

## How it works

`CadenzaScreen` fetches the user's tags and complete Apple Music song library. It compiles the
ordered `QueryCondition[]` with `queryToJSON`, sends every catalog id as the backend candidate
set, and maps the returned ids back to the cached library tracks. Supplying the complete candidate
set is what lets a NOT query include songs that have no Cadenza tags at all.

The conditions live on the tab screen, so they survive tab switches. Opening the full result set
pushes `/query-results` above the tab navigator and leaves this screen mounted underneath; closing
the result hero therefore returns to the existing conditions instead of clearing them.

## Connects to

- `@/features/query-builder` for query construction and results.
- `@/lib/routes/tags` and `@/lib/routes/queries` for backend data.
- `@/lib/musickit-hooks::useAllTracksFromLibrary` for the candidate set and result metadata.
- `@/features/library` owns tags now, including tag creation.

## Gotchas

- Query state lasts for the lifetime of the mounted Cadenza tab. It is not persisted across app
  launches.
- Tag creation lives in the Tags library sheet, not here. Query needs tags to exist before it is
  useful, so a user with no tags has to go make one from the library first.

---

Touching files in this directory? Update this README in the same change.
See [../../../../AGENT_GUIDE.md](../../../../AGENT_GUIDE.md).

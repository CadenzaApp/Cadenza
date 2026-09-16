# cadenza

The simple and advanced query workspaces rendered by the Cadenza tab. This feature owns both
query trees, the active mode, tag data, library metadata, and the shared result preview, so an
in-progress mix survives switching modes or tabs.

Tags used to share this screen behind a Query / Tags segmented control. They are a library
category now, opened from the library screen, so this tab is only the query builder. See
[../library/README.md](../library/README.md).

## Files

| file                | role                                                                              |
| ------------------- | --------------------------------------------------------------------------------- |
| `CadenzaScreen.tsx` | The query builder, tag data, query state, live preview, and results-route launch. |

## How it works

`CadenzaScreen` fetches the user's tags and complete Apple Music song library. The mode button
switches between the tactile simple builder and the filter-based advanced builder without
discarding either tree. The simple path compiles `QueryCondition[]` with `queryToJSON` and sends
every catalog id as the backend candidate set. The advanced path compiles its tree with
`buildAdvancedQuery` and runs the advanced endpoint after Create mix is pressed. Both map returned
ids back to the same cached library tracks and render the same `ResultsSummary`.

Supplying the complete candidate set on the simple path is what lets a NOT query include songs
that have no Cadenza tags at all. The advanced backend currently evaluates songs represented in
Cadenza's applied-tag data.

The conditions live on the tab screen, so they survive tab switches. Opening the full result set
pushes `/query-results` with the active builder kind and serialized query. The route dispatches to
the matching endpoint but always renders the same `QueryResults` hero. This screen remains mounted
underneath, so closing the hero returns to the existing query and active mode.

## Connects to

- `@/features/query-builder` for the simple query and shared result presentation.
- `@/features/advanced-query-builder` for advanced filter construction and compilation.
- `@/lib/routes/tags` and `@/lib/routes/queries` for backend data.
- `@/lib/musickit-hooks::useAllTracksFromLibrary` for the candidate set and result metadata.
- `@/features/library` owns tags now, including tag creation.

## Gotchas

- Both query trees last for the lifetime of the mounted Cadenza tab. They are not persisted across app
  launches.
- Tag creation lives in the Tags library sheet, not here. Query needs tags to exist before it is
  useful, so a user with no tags has to go make one from the library first.

---

Touching files in this directory? Update this README in the same change.
See [../../../../AGENT_GUIDE.md](../../../../AGENT_GUIDE.md).

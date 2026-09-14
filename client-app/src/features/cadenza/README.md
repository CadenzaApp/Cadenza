# cadenza

The boolean-query workspace rendered by the Cadenza tab. It owns the tag request and the query
state, so an in-progress mix survives switching tabs.

Tags used to share this screen behind a Query / Tags segmented control. They are a library
category now, opened from the library screen, so this tab is only the query builder. See
[../library/README.md](../library/README.md).

## Files

| file                | role                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| `CadenzaScreen.tsx` | The query builder, its tag data, the query state, and the results. |

## How it works

`CadenzaScreen` fetches the user's tags once and hands them to `QueryBuilder` as the palette. The
query tree and its fetched results live on the screen, so they survive navigating away and back.
Running a query swaps the builder for `QueryResults`; the back button there clears the result and
returns to the tree. `TagGenerationNotice` sits above both. It is static for now: it always shows,
whether or not any songs are still being tagged.

## Connects to

- `@/features/query-builder` for query construction and results.
- `@/components/custom/tag-generation-notice` for the banner above the builder and the results.
- `@/lib/routes/tags` and `@/lib/routes/queries` for backend data.
- `@/lib/musickit-hooks` for query-result song metadata.
- `@/features/library` owns tags now, including tag creation.

## Gotchas

- Query state lasts for the lifetime of the mounted Cadenza tab. It is not persisted across app
  launches.
- Tag creation lives in the Tags library sheet, not here. Query needs tags to exist before it is
  useful, so a user with no tags has to go make one from the library first.

---

Touching files in this directory? Update this README in the same change.
See [../../../../AGENT_GUIDE.md](../../../../AGENT_GUIDE.md).

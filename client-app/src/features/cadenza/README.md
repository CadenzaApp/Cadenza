# cadenza

The combined tag and boolean-query workspace rendered by the Cadenza tab. The screen owns the
shared tag request and query state so switching views does not discard an in-progress mix.

## Files

| file                | role                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| `CadenzaScreen.tsx` | Segmented Query and Tags screen, shared data, query state, and results. |
| `TagsView.tsx`      | Tag count, tag pills, tag-detail navigation, and tag creation.          |

## How it works

`CadenzaScreen` fetches the user's tags once. Query is the default view. Its tree and fetched
results live above the segmented content, so they remain available after visiting Tags. The
Tags view renders the same tag management surface and links each pill to `/tag/:tagId`.

## Connects to

- `@/features/query-builder` for query construction and results.
- `@/lib/routes/tags` and `@/lib/routes/queries` for backend data.
- `@/lib/musickit-hooks` for query-result song metadata.
- `@/components/custom` for tag pills and tag creation.

## Gotchas

- Query state lasts for the lifetime of the mounted Cadenza tab. It is not persisted across app
  launches.
- The Create Tag dialog is mounted only while the Tags view is selected.

---

Touching files in this directory? Update this README in the same change.
See [../../../../AGENT_GUIDE.md](../../../../AGENT_GUIDE.md).

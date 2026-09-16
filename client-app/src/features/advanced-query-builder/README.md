# advanced-query-builder

Obsidian-style filter builder for attribute tags. Instead of dragging tags into a boolean tree,
the user builds nested groups of `where <tag> <operator> <value>` lines, so a query can look at
a tag's value ("created_at on or after 1950-01-01"), or at tag names, values, and types across
every tag on a song. Rendered by `src/app/advanced-query.tsx`, which owns the tree state and the
fetch. Reached from the "Advanced" button under the simple query builder.

## Files

| file | role |
| --- | --- |
| `types.ts` | The builder tree (`AdvancedGroupNode`, `AdvancedFilterNode`), `FilterField`, `FilterOp`, and the wire format (`AdvancedQueryJSON`). |
| `AdvancedQueryUtils.ts` | Pure: operator tables and labels, immutable tree ops, date helpers, and `buildAdvancedQuery`, which compiles the tree for the wire. Unit tested in `AdvancedQueryUtils.test.ts`. |
| `AdvancedQueryBuilder.tsx` | Scrollable root group plus the submit button. Binds the tree ops into a `BuilderActions` object. |
| `FilterGroup.tsx` | One group: the all / any / none selector, its children, and the "Add filter" / "Add filter group" buttons. Recursive. Exports `BuilderTags` and `BuilderActions`. |
| `FilterRow.tsx` | One filter line: connector word, field picker, operator picker, value input, and the remove button. Exports `RemoveButton`. |
| `FilterValueInput.tsx` | The value input for a line: text, number, a calendar day, a date and time, or a tag type. |
| `OptionPicker.tsx` | Popup list of choices with optional sections and search. Its own `Modal`, sized for a phone: near full width, up to 80% of the screen tall, 56pt rows. Scrolls vertically and wraps long labels. |
| `field-icons.ts` | `TYPE_ICONS` (an alias of `@/lib/tag-values::TAG_TYPE_ICONS`, shared with `TagPill`), and the three "property" fields (tag name, tag value, tag type). |

## The model

```ts
type AdvancedGroupNode  = { kind: "group";  id; conjunction: "and"|"or"|"none"; children: AdvancedNode[] };
type AdvancedFilterNode = { kind: "filter"; id; field: FilterField | null; op: FilterOp | null; value: string };
type FilterField = { kind: "tag"; tagId } | { kind: "tag_name" } | { kind: "tag_value" } | { kind: "tag_type" };
```

The root is always a group and cannot be removed. New groups start with one empty filter. A
filter's operator list comes from its `FieldKind`: the tag's type for a `tag` field, otherwise
the field itself (`OPERATORS_BY_FIELD`). `valueKindFor(kind, op)` picks the input, and is
`"none"` for `is_empty`, `is_true`, `is_applied` and the like. `withField` / `withOp` keep the
operator and value when they still fit and reset them otherwise. Every tag type's list ends with
"is applied" / "is not applied" (`APPLIED_OPS`), which ignore the value; the tag name, tag value
and tag type fields do not offer them.

Date tags and datetime tags offer the same operators. A date filter holds a local `YYYY-MM-DD`
day and picks no time. A datetime filter holds an ISO timestamp with its seconds dropped
(`toDateTimeValue`), since the backend compares datetimes to the minute. The line reads "where" first,
then "and" in an all group and "or" in an any or none group.

## Submitting

`buildAdvancedQuery(root, tagTypes)` returns `{ ok: true, query }` or
`{ ok: false, error }`. It drops groups with no filters in them, and errors on an unfinished
filter, a deleted tag, a non-numeric number, or a query with no filters at all. Groups become
`{and: [...]}`, `{or: [...]}`, and none becomes `{not: {or: [...]}}`. Each line becomes
`{filter: {field, tag_id?, op, value?}}`, and the whole thing is sent as `{where: ...}`.

The screen sends it through `useAdvancedQueryResults()` from `@/lib/routes/queries`, as the `q`
param of `GET /queries/advanced/results`. Song ids come back sorted by id. The screen feeds them
to `useSongInfo` and shows the shared `QueryResults` view, or a "No songs match" message.

## Connects to

- `@/lib/types::Tag`, `@/lib/tag-values` for type labels, and `@/lib/routes/tags::useUserTags`
  by way of the screen.
- `@/components/ui/*`, `@react-native-community/datetimepicker`.
- `@/features/query-builder/QueryResults` for the results view.
- Backend: `GET /queries/advanced/results`, schema in
  `backend-api/src/routes/json/advanced_query.rs`, compiled to SQL in
  `backend-api/src/db/advanced_queries.rs`.

## Gotchas

- Semantics live on the backend. A song without the tag counts as empty, so `is not`, `not on`,
  `ne`, `is empty`, and `is null` match it. Text matching ignores case.
- Only songs with at least one tag can ever match, same as the simple query.
- `advanced-query` is a root stack route, not a tab, so `MediaPlayerHost` renders no player there.
  Results still play; the player shows again once you go back.
- The screen sets its header title with an inline `Stack.Screen`, not an entry in the root
  `_layout.tsx`.
- Any edit resets the last result or error, so the message under the tree always matches it.
- Node ids come from a module-level counter, not `nanoid`, so the pure utils stay import-free.

---
Touching files in this directory? Update this README in the same change.
See [../../../../AGENT_GUIDE.md](../../../../AGENT_GUIDE.md).

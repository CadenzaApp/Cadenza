# query-builder

Drag and drop boolean query building. The user drags tags and `AND` / `OR` / `NOT` blocks from a
palette into a tree, hits submit, and gets back the song ids that match. Rendered by
`src/app/(tabs)/query.tsx`, which owns the tree state and the fetch.

## Files

| file | role |
| --- | --- |
| `types.ts` | `QueryNode` tree, `PaletteItem`, `SlotAddress`, and `QueryJSONNode` (the wire format). |
| `QueryBuilder.tsx` | Renders the tree. Takes `root` / `setRoot` / `onSubmit` as props, handles drop and remove. |
| `QueryUtils.ts` | Pure tree operations plus `queryNodeToJSON`, which compiles the tree for the wire. |
| `DragContext.tsx` | `DragProvider` / `useDrag`. Drag state, the drop-zone registry, and the node-operator registry. |
| `DraggablePill.tsx` | A palette item you can pick up. |
| `DragGhost.tsx` | The thing that follows your finger. |
| `DropSlot.tsx` | A registered drop target. Highlights when hovered, rejects redundant drops. |
| `LogicNode.tsx` | Renders an `AND` / `OR` / `NOT` box and its child slots. Exports `OPERATOR_COLORS`. |
| `PaletteSection.tsx` | The tag palette and the operator palette. |
| `QueryResults.tsx` | Post-submit view: the matched songs, playable, with the detail modal. |

## The model

A query is a tree of two node kinds:

```ts
type QueryNodeTag   = { kind: "tag";   id: string; tag: Tag };
type QueryNodeLogic = { kind: "logic"; id: string; operator: "and"|"or"|"not";
                        children: (QueryNode | null)[] };
```

`null` children are the empty slots you can drop into. `not` always has exactly one slot.
`and` / `or` start with two and grow: `removeNode` pads back up to two so there is always
somewhere to drop, and an `"append"` drop fills the first empty slot or pushes a new one.

Slots are addressed by `SlotAddress`, which is `{nodeId: "root"}`, `{nodeId, index}`, or
`{nodeId, index: "append"}`. `id`s come from `nanoid`, so tree ops can be structural and pure.

## How a drag works

1. `DraggablePill` starts a gesture and sets `dragState` on `DragContext`.
2. `DragProvider` measures and caches every registered drop zone rect on drag start.
   `DropSlot` registers and unregisters itself by `slotKey`.
3. As the finger moves, `findZoneAt(x, y)` hit tests against the cached rects and sets
   `hoveredKey`. `DragGhost` renders at the finger position.
4. On release, `QueryBuilder.handleDrop(item, address)` runs `insertAtSlot` and calls `setRoot`.
   Every tree function returns a new tree; nothing mutates.

`DragContext` also carries a node-id to operator registry, so a `DropSlot` can tell that you are
dropping `AND` into an `AND` and reject it without prop drilling. `QueryBuilder.handleDrop`
checks the same thing again before inserting.

## Submitting

`queryNodeToJSON` compiles the tree into `QueryJSONNode`: a tag becomes its bare numeric id, and
a logic node becomes `{and: [...]}`, `{or: [...]}`, or `{not: child}`. Any remaining `null` slot
throws the string `"incomplete query"`.

`src/app/(tabs)/query.tsx` calls `queryNodeToJSON` and hands the result to `useQueryResults()`
from `@/lib/routes/queries`, which sends it as the `q` param of `GET /queries/results`. Song ids
come back ordered by relevance (the backend scores each song by how many of the queried tags it
carries). The query tab feeds those ids to `useSongInfo` for Apple Music metadata, then renders
`QueryResults`. `resetQuery` clears the results and drops you back on the builder.

## Connects to

- `@/lib/types::Tag`, and `@/lib/routes/queries::useQueryResults` by way of the query tab.
- `@/components/custom/tag-pill`, `music-list`, `song-detail-modal`.
- `@/lib/playback` and `@/lib/apple-music-auth` from `QueryResults`.
- Backend: `GET /queries/results`, compiled to SQL in `backend-api/src/db/queries.rs`.

## Gotchas

- `queryNodeToJSON` throws a bare **string**, not an `Error`, on an incomplete query. Nothing
  catches it in `query.tsx`, so a half-built query throws out of the submit handler with no
  user-visible feedback.
- `getSongsFromQuery` is still exported from `QueryUtils.ts` but nothing calls it. It posts to
  the old `POST /queries` route, which no longer exists. Dead code.
- `nanoid` is imported here but is not in `client-app/package.json`. It resolves as a transitive
  dependency today, which is fragile.
- `QueryBuilder` renders its own `GestureHandlerRootView` even though the root layout already has
  one. Nested, but it works.
- Drop zone rects are cached at drag start. If the layout shifts mid-drag (a scroll, a keyboard),
  hit testing goes stale.
- This file uses `DOMRect` as the measurement type even though these are native measurements.
- `removeNode` on the root returns `null`, which clears the whole query.

---
Touching files in this directory? Update this README in the same change.
See [../../../../AGENT_GUIDE.md](../../../../AGENT_GUIDE.md).

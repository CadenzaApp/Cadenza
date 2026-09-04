# query-builder

Drag and drop boolean query building. The user drags tags and `AND` / `OR` / `NOT` blocks from a
palette into a tree, hits submit, and gets back the song ids that match. Rendered by
`src/app/(tabs)/query.tsx`.

## Files

| file | role |
| --- | --- |
| `types.ts` | `QueryNode` tree, `PaletteItem`, `SlotAddress`, and `QueryJSONNode` (the wire format). |
| `QueryBuilder.tsx` | Owns the tree. Holds `root`, handles drop and remove, submits. |
| `QueryUtils.ts` | Pure tree operations plus `getSongsFromQuery`, which posts to the backend. |
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
4. On release, `QueryBuilder.handleDrop(item, address)` runs `insertAtSlot` and sets a new root.
   Every tree function returns a new tree; nothing mutates.

`DragContext` also carries a node-id to operator registry, so a `DropSlot` can tell that you are
dropping `AND` into an `AND` and reject it without prop drilling. `QueryBuilder.handleDrop`
checks the same thing again before inserting.

## Submitting

`queryNodeToJSON` compiles the tree into `QueryJSONNode`: a tag becomes its bare numeric id, and
a logic node becomes `{and: [...]}`, `{or: [...]}`, or `{not: child}`. Any remaining `null` slot
throws the string `"incomplete query"`.

`getSongsFromQuery` posts that to `POST /queries` with the JWT and gets back song ids ordered by
relevance (the backend scores each song by how many of the queried tags it carries). The query
tab feeds those ids to `useSongInfo` for Apple Music metadata, then renders `QueryResults`.

## Connects to

- `@/lib/types::Tag`, `@/lib/account::useAccount` (for the JWT), `@/lib/backend::BACKEND_URL`.
- `@/components/custom/tag-pill`, `music-list`, `song-detail-modal`.
- `@/lib/playback` and `@/lib/apple-music-auth` from `QueryResults`.
- Backend: `POST /queries`, compiled to SQL in `backend-api/src/db/queries.rs`.

## Gotchas

- `queryNodeToJSON` throws a bare **string**, not an `Error`. `QueryBuilder.onSubmit` catches it
  and only `console.error`s, so an incomplete query fails with no user-visible feedback.
- `getSongsFromQuery` uses raw `fetch`, not the SWR wrappers in `@/lib/swr-utils`. No cache, no
  invalidation. `@/lib/routes/queries.ts` exists but is empty; that is where this belongs.
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

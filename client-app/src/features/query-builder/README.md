# query-builder

An ordered, tactile boolean query builder. Each top-level condition after the first has an AND/OR connector.
A condition is either one tag or a flat group of two or more tags in `any` (OR) or `all` (AND)
mode. Every tag instance can be negated independently.
When a top-level condition is removed, the condition before it remembers that boundary's connector.
Adding a replacement in the same position restores the prior AND/OR choice. Reordering keeps
connectors attached to visual boundaries instead of moving them with condition cards.

## Files

| file                 | role                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| `types.ts`           | Condition, group, tag-instance, drag, drop, and query JSON types.           |
| `QueryUtils.ts`      | Pure condition edits, group collapse, derived labels, and JSON compilation. |
| `QueryUtils.test.ts` | Reducer invariants and wire-format tests.                                   |
| `QueryBuilder.tsx`   | Composes the scrollable simple workspace and resizable tag palette.         |
| `ResultsSummary.tsx` | Shared live count and compact-inset tagged preview used by both builders.   |
| `ConditionList.tsx`  | Single conditions, groups, connectors, mode toggles, and insertion targets. |
| `QueryTagPill.tsx`   | Palette and query pill states, including the NOT indicator.                 |
| `TagPalette.tsx`     | Searchable tag palette and query-tag delete target.                         |
| `DragContext.tsx`    | Drag state, measured drop-zone registry, and hit testing.                   |
| `DraggablePill.tsx`  | Thresholded tag pans and long-press-activated group pans.                   |
| `DropSlot.tsx`       | Registers and highlights a typed drop target.                               |
| `DragGhost.tsx`      | Floating tag shown during an active drag.                                   |
| `QueryResults.tsx`   | Configures the full-screen query-match view, gradient, and save dialog.     |

## The model

`QueryCondition[]` preserves the user's top-level order. Each appearance of a tag has a session
ID and its own `negated` value. The same tag can appear in separate conditions, but a group rejects
duplicate tag IDs. A group has `mode: "any"|"all"` and an ordered `members` array. Helpers never leave a one-member group: removing or extracting
a member immediately replaces that group with its remaining tag.

`queryToJSON` emits the backend's recursive format. Top-level connectors compose from left to right,
with adjacent uses of the same operator flattened into one expression. A divider's connector belongs
to the condition below it. An individual top-level condition retains the existing `{and: [...]}` wrapper,
an any group becomes `{or: [...]}`, an all group becomes `{and: [...]}`, and a negated tag
becomes `{not: tagId}`. An empty query returns `null` and does not fetch.

## Interaction flow

Palette tags are drag-only and can be dropped on an insertion point. The blank workspace all
the way down to the palette is also an append target. A reserved bottom inset keeps some of this
append target visible after the existing conditions. The empty state uses the base theme background
instead of changing surface color. Dropping a tag on a single creates an any
group; dropping on a group adds a member. Query tags can be reordered, moved into another
condition, extracted from a group, or dropped on the transformed palette to delete them. A
single condition keeps a stable layout identity when it expands into or collapses from a group.
The condition card uses the shared liquid-glass surface while keeping each tag pill solid. It clips
its contents while its height animates, and the HAVE ANY/HAVE ALL control fades
and shifts slightly down when added or up when removed. A
movement threshold keeps a tap available for toggling NOT. Basic tags use a circle indicator and
switch it to a close-circle when negated. Attribute tags keep their type icon in both states.
Every negated tag uses a thin text strike and a tag-colored outline instead of a solid fill. The
whole HAVE ANY/HAVE ALL control toggles the
group mode. Top-level connector dividers use solid rounded controls and toggle between AND and OR when tapped; dividers before a
single-tag condition read `AND HAVE` or `OR HAVE`. Dragging the handle or `Your tags` heading resizes the palette between 80 and 360
pixels. The handle keeps its small visual indicator but uses a larger overlapping touch surface. At minimum height only the resize handle and heading/search row remain visible, providing a
collapsed palette state. Its initial 208-pixel height increases by the visible mini-player inset so the player does
not cover the first tag rows. The heading and search field share one comfortably spaced row inside the
same vertical scroll surface as the tags; only the resize handle stays fixed.
Every top-level condition, including a single-tag condition, uses the screen background and can
be reordered. Pressing and holding its surface for 300 milliseconds activates a whole-condition
drag. Tag pills block that parent gesture so they can only start individual tag drags. The parent
gesture also maintains an explicit descendant-touch lock, so native gesture arbitration cannot
activate a condition drag from a tag pill. Tag destinations remain visual previews until release.
Idle cards use their natural content height, including groups whose tags wrap across many rows.
Only an active drag freezes the original card at its measured width and height and collapses a
same-size source reservation. Release explicitly restores `auto` height so the native animated
style cannot retain the reservation's zero height. The card remains locked horizontally and renders above every
other condition while it follows vertical movement. The active card opts out of keyed layout transitions,
and inverse source and destination offsets keep its vertical center anchored to the finger as the preview changes.
Group drag hit-testing and release derive the card center from one stable gesture-translation coordinate space.
Release is staged across two frames: the first arms the moved card's layout transition without changing
its position, and the next animation frame commits the new order so settling begins at the finger's final coordinate.
A synchronous release latch keeps finalization from clearing the captured reorder or delete target
between those frames.
Whole-condition drags suppress card-height, member-tag layout, and HAVE ANY/HAVE ALL entrance or
exit animations through the complete release settle. Non-dragged cards use a position-only transition,
while position-keyed connector slots preserve the inter-card geometry throughout the live preview. The
actively dragged condition opts out of that outer transition. On release, the card clears
its inner drag transform and an interaction-free copy is placed in the full-screen portal at the exact
absolute release center. The reordered card stays hidden while its final screen center is measured. The
hidden card's connector and local spacer heights settle immediately before that measurement. The portal
copy then performs the only release animation between those two absolute coordinates, so connector
insertion and parent reflow cannot change either endpoint. The drag reservation does not clip the card
while its final vertical translation settles, and the released card remains above sibling cards for that
complete interval. The keyed outer wrapper owns layout and stacking, while separate nested wrappers own
the removal fade and release visibility. Layout transitions animate geometry only, so they cannot
overwrite either opacity effect. On release,
preview spacers stop using the drag payload's old index and every connector slot immediately assumes its
committed height before the destination is measured. A newly required connector stays invisible in that
reserved space until the card settles. Its committed height remains locked through the complete fade and
horizontal expansion, so revealing it cannot alter the gap between cards. Connector slots are keyed to
visual boundary positions rather than condition cards. Reordering therefore updates the existing boundary
in place instead of deleting one condition-owned connector and mounting another. The live destination
reservation remains mounted until the reordered condition array reaches its final index, then swaps for
the permanent boundary in the same render. Idle slots always use fixed geometry, so an old animated
spacer value cannot reappear after the release completes. Connector and destination-spacer heights keep
one shared animated value for their entire lifetime; committed heights update that value before paint
instead of swapping between static and animated style ownership. Content
transitions remain reserved for edits that actually change a condition's contents or size.
The source layout
slot collapses while an equal-height destination spacer opens. Crossing another condition's vertical
center immediately animates every non-dragged condition into the order it would have after release;
whole-condition drags do not display insertion labels. Dropping one on the tag palette deletes it in
one action. A dragged condition's preceding connector fades and contracts toward its center without
changing the reserved vertical space until the card leaves its original index. At that point the
unused source gap closes and the destination reserves one card plus one connector. Keyed layout
transitions carry the preview into the committed order on release. Connectors that become necessary
after a reorder or new-condition insertion reserve their height while the preview is active, remain
invisible until that reserved space has settled, then fade and expand horizontally at their final
vertical coordinate. Reorder, compensation, and connector-space changes share a softer 320 ms easing
curve. Switching HAVE ANY and HAVE ALL animates member tags into the space required by the
changing OR and AND labels, including movement between wrapped rows.
Removing a top-level condition, including by moving its only tag into another group, fades the
old condition out while the destination updates.

Out-of-group drop targets preview insertion with a tag-colored line labeled `create new tag
group`. The line animates outward from its center. The palette search field uses native liquid glass
when available and retains its outlined themed surface on Android and older iOS. The palette delete
target fades a black surface over its contents, then fades in
a destructive trash icon and label. Both layers fade away when the drag leaves the palette.
Palette and query tags use the shared app-wide solid-color `TagPill` styling. Negated tags
replace the standard leading dot with a close-circle icon. Reordering, grouping,
extracting, and deleting query tags are drag-only interactions; pills have no inline controls.

The Cadenza tab owns conditions, so returning from the full list preserves the query. Full results
are a normal opaque root-stack view rather than a zoom/pull-dismissed card. It keeps its own safe
area and floating close control, and the app-level compact player renders over it. The results surface uses
`TrackCollectionView` with a weighted artwork
mosaic, play and shuffle queues, local Music List sorting, and a caller-supplied save option. Its
page tint averages the representative colors for the four mosaic cells, then uses the same
full-height darkening gradient as collection details. A fixed viewport copy sits under the
scrolling gradient so elastic overscroll continues the correct color at either edge. One
distinct artwork renders as a single image instead of a repeated grid. The results surface owns the
save-name popup, rendered through the same reliable liquid-glass modal path as Sort. Its round Save
Query action is glass too. The dialog stays at 75 percent of the screen width and sits above the keyboard; submit
currently logs that persistence is not implemented. Search text and preview expansion live inside
their surfaces and reset when those surfaces unmount. Query results show row tags and enable Music
List multi-selection with its built-in Add to Queue action.

The Cadenza screen owns the shared result summary. Its result-count control and mode button use
liquid glass, with the mode button sitting between the count and next arrow. Expanding the count
opens a liquid-glass preview layered over the editor instead of resizing or shifting it. The mode
button swaps this editor for the filter-based advanced builder without navigating or discarding
either query tree. Both modes open `/query-results`, which
dispatches to the matching endpoint and renders the same full-screen hero. See
[../advanced-query-builder/README.md](../advanced-query-builder/README.md).

## Connects to

- `src/features/cadenza/CadenzaScreen.tsx` for session state and full-library result wiring.
- `@/lib/routes/queries::useQueryResults` for live candidate-based query evaluation.
- `@/lib/musickit-hooks::useAllTracksFromLibrary` for the complete library candidate set.
- `@/components/custom/music-list` for preview and full results.
- Backend `POST /queries/results` for correct NOT behavior on completely untagged songs.

## Gotchas

- Drop rectangles are measured when dragging activates. Scrolling while a drag is active can
  make those cached coordinates stale.
- Do not dynamically toggle NativeWind shadow or alpha (`/…`) utilities on query-builder
  controls. In the current Expo Router/NativeWind combination that can surface as a misleading
  missing-navigation-context error; use an inline style for a stateful visual instead.
- The backend accepts at most 50,000 candidate song IDs in one query request.
- A disconnected Apple Music account can edit a query, but cannot produce library results.

---

Touching files in this directory? Update this README in the same change.
See [../../../../AGENT_GUIDE.md](../../../../AGENT_GUIDE.md).

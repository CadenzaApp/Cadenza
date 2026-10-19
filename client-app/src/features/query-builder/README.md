# query-builder

Simple Boolean queries over basic tags, value tags, and song metadata. Cadenza owns drafts,
history, settings, and results navigation; see [../cadenza/README.md](../cadenza/README.md).

## Entry points

| File                                                         | Responsibility                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `QueryBuilder.tsx`                                           | Drop edits, tap placement, constraint editing, and palette position.                  |
| `ConditionList.tsx`                                          | Cards, insertion gaps, connectors, and editor-action context.                         |
| `MeasuredReorderList.tsx`, `reorder-utils.ts`                | Variable-height reorder gestures, springs, and release lifecycle.                     |
| `DragContext.tsx`, `drag-utils.ts`                           | Drag sessions, measurements, hit testing, and targeted hover subscriptions.           |
| `DropViewport.tsx`, `DropSlot.tsx`                           | Shared scroll/clipping geometry and registered drop targets.                          |
| `DraggablePill.tsx`, `DragGhost.tsx`                         | Tag gestures and pickup presentation.                                                 |
| `GroupModeControl.tsx`                                       | Compact sliders and optional interactive Venn diagrams.                               |
| `TagPalette.tsx`, `palette-geometry.ts`                      | Sliding palette, search, sections, and height limits.                                 |
| `TagConstraintDialog.tsx`, `QueryTagPill.tsx`                | Typed predicates and their pill labels.                                               |
| `QueryUtils.ts`, `QueryConversion.ts`, `metadata-palette.ts` | Immutable edits, wire compilation, one-way Advanced seeding, and metadata identities. |
| `ResultsSummary.tsx`, `QueryResults.tsx`                     | Result count/action and the full playable collection.                                 |

## Query semantics

Simple has one outer ALL/ANY rule. Every edit normalizes boundary connectors, so reordering
cannot change Boolean meaning. The compiler also preserves left-to-right legacy mixed
connectors; seeding Advanced expresses those explicitly as nested groups.

A condition is a single tag, optionally negated, or a flat group. ALL means AND, ANY means OR,
and NONE means NOT OR. A positive single promoted to a group starts at ALL; a negative single
starts at NONE. Removing a group's penultimate tag collapses it to a single, negated for NONE.
A stable layout identity survives promotion and collapse. Groups reject duplicate tag IDs.
Value tags share Advanced's operators, typed inputs, and validation. Metadata pills use negative
IDs only for presentation and compile to metadata fields rather than stored tag IDs.

## Construction and palette

Drag tags onto cards to join groups or onto insertion gaps/blank workspace to create groups.
Tap a palette tag to add it immediately when empty; otherwise choose a dashed placement outline.
Tap elsewhere to cancel. Tap a basic query tag to remove it; value tags open an edit/delete popup.
New value tags enter the query only after Apply. Text predicates render quoted values.
The keyboard-aware glass popup keeps value operators beside the input and valueless operators below.

The palette has one outlined search field and basic, suggested, advanced, and metadata sections.
Optional sections have compact headings and rules. Owned tags show applied-song counts;
query pills omit counts. Your tags and Search scroll with the tags; the resize handle stays fixed.
Memoized sections/cells and symmetric padded pill touch areas keep interaction costs bounded.

The sheet stays 450 points tall and moves with a UI-thread translation. Its initial visible height
is 268 points plus any compatibility-player inset. The minimum includes the platform tab/player
inset and 64 points for the handle/heading. Floating actions follow its top edge; query scroll
clearance updates on release. A fixed bottom spacer lets the final tag row reach the top.
Collapsing resets palette scroll and hides offscreen tag actions from accessibility.

## Gesture and rendering contracts

- Keep pan gestures stable during pickup. Replacing a gesture during drag can cancel it.
  Handles reorder cards; other card controls and surfaces retain their own interactions.
- Commands, presentation, and keyed hover subscriptions are separate. Only the old and new
  hover targets are notified. Coordinates and palette motion stay on the UI runtime.
- Drop sessions await pickup measurements and remeasure on release. Version checks reject
  canceled/stale sessions; native measurement times out if a view disappears. Cached rectangles
  follow scroll/sheet offsets and clip against the heading, palette, and navigation/player.
- Settled reorder rows use natural layout. Transforms spring neighbors aside during drag.
  Release keeps the source elevated until its spring, commit, React order, and native layout
  all agree. Canceled, rejected, and failed drops roll back and complete cleanup.
- Do not apply native entering/exiting opacity animations to glass ancestors. Group entry uses
  a separate translation wrapper; scroll clipping is disabled to keep native glass attached.
  On iOS 26, animating an ancestor through zero opacity can leave its material transparent.
- Keep shared-constant defaults inside worklet bodies; serialized default arguments cannot
  access captured constants before the closure is unpacked.
- Avoid dynamically switching NativeWind shadow/alpha utilities on these controls; use inline
  dynamic styles to avoid the existing native navigation-context failure.

## Validation

`QueryUtils.test.ts` checks edits and wire shapes. `QueryConversion.test.ts` checks one-way
seeding, metadata/value predicates, truth tables, and reorder invariance. `drag-utils.test.ts`
covers clipping, fast/stale drops, measurement failure, and targeted hover notifications.
`reorder-utils.test.ts` covers variable heights, repeated swaps, native layout acknowledgement,
edge scrolling, and release rollback. `scripts/palette-worklets.test.cjs` executes the transformed
palette helpers in an isolated runtime. History/draft tests live in Cadenza.
Native gesture smoothness and glass rendering require real-device verification.

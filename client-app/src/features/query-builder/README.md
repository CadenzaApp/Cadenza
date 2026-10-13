# query-builder

A boolean query editor. Drag a palette tag onto a card to join its group, or into an insertion
gap or empty workspace to create a condition. Tapping a palette tag adds it immediately when
the query is empty; otherwise it hides the palette tags and offers outlines at each eligible
group and below the last group. Tap an outline to place the tag, or tap elsewhere to cancel.
Tap a basic query tag to remove it, or tap a value tag to edit its predicate or delete it.
Drag query tags to move, extract, or delete them; use
the grip to reorder a whole condition.

## Files

| File                                                                    | Role                                                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `QueryBuilder.tsx`                                                      | Workspace, palette resizing, group deletion, and drop edits.                                        |
| `ConditionList.tsx`                                                     | Cards, explicit HAVE/DON'T HAVE, group controls, connectors, and reorder reservations.              |
| `GroupModeControl.tsx`                                                  | Shared compact sliders for group, heading, and single-tag logic, plus the Venn diagram.             |
| `EditorActions.tsx`                                                     | Group actions and diagram preference shared with cards and the release ghost.                       |
| `TagPalette.tsx`                                                        | One search over basic, suggested, value, and metadata sections; palette resizing and delete target. |
| `metadata-palette.ts`                                                   | Stable on-screen metadata tag identities and field keys.                                            |
| `TagConstraintDialog.tsx`                                               | Value-tag operator and input popup, shared by drag, tap placement, and edits.                       |
| `QueryUtils.ts`                                                         | Immutable tag/group edits and wire compilation.                                                     |
| `QueryConversion.ts`                                                    | Outer-operator normalization and lossless Simple/Advanced conversion.                               |
| `ResultsSummary.tsx`                                                    | Floating result count/action and loading/error/empty states.                                        |
| `QueryResults.tsx`                                                      | Full results collection, artwork tint, playback, and query-play recording.                          |
| `DragContext.tsx`, `DraggablePill.tsx`, `DropSlot.tsx`, `DragGhost.tsx` | Gestures, hit testing, and drag/release presentation.                                               |

## Semantics and edits

The Cadenza screen owns conditions and one outer All groups / Any group operator. Simple normalizes
all boundary connectors after every edit, so a reorder cannot change its Boolean meaning. The
pure legacy compiler still preserves left-to-right mixed connectors; conversion to Advanced
expresses that grouping explicitly rather than changing old queries.

A condition is a single tag, optionally excluded, or a flat group of positive tags. ANY is OR,
ALL is AND, and NONE is NOT OR. Removing a group's penultimate tag collapses it to a single;
a NONE group becomes an excluded single. Group members reject duplicate tag IDs. Each tag
instance records whether it came from the suggested palette. A positive single promoted into a
group starts at ALL; a negated single promoted into a group starts at NONE.

Single conditions expose HAVE / DON'T HAVE followed by "the tag:"; groups read
"Have [ALL / ANY / NONE] of the tags:". Each
card has a red trash button that deletes the whole condition. There are no tag tap menus,
inline add buttons, or Add group button. Value tags use Advanced's operator list, typed input,
and validation. A new value tag enters the query only after its predicate is saved; tapping one
already in the query opens the same editor with Delete. Basic tags keep the direct tap-to-remove
behavior. The glass popup keeps the pill-shaped operator choices, wrapping value-based choices
in a left column beside the centered input and placing value-free choices below. Editing offers
a trash button. The pill shows its operator and formatted value; text values are quoted
without a separator character.
Metadata fields use the same popup but compile to `field: "metadata"` rather than a tag ID.
Simple/Advanced conversion preserves metadata predicates and validates them against the
metadata operator table.
CadenzaScreen owns heading Clear and floating Undo/Redo beside the results button. History
includes add, remove, and other query edits.

The mode control supports taps, horizontal slides, and screen-reader radio actions. Sliding
previews the mode and commits on release. Vertical movement remains available for scrolling.
ANY shades the union, ALL the intersection, and NONE the outside of both circles inside a box.
Diagrams use subdued theme-dependent gray fills at full opacity, with a softer box border.
Tapping a diagram cycles ALL/ANY/NONE or toggles HAVE/DON'T HAVE for a single tag. Diagrams sit in the bottom-right corner with space reserved beside the tags and can be hidden in query settings. Singles
show a boxed circle: HAVE fills the circle and DON'T HAVE fills its surroundings. Slider labels stay on one line and widths follow font scaling.
Tag rows join members with AND for ALL, OR for ANY, and NOR for NONE. Together with the heading,
colons, and inter-card AND/OR dividers, the query reads from top to bottom. Segments use
compact widths instead of stretching to fill their card. Tapping a boundary AND/OR toggles
the same global matching rule as the outer ALL/ANY slider. Boundary controls have a bordered
solid pill surface and compact type. Single-tag segments use different widths to fit their labels.

## Palette and surfaces

Palette resizing runs on the UI thread and commits its height on release. The main heading
and search stay fixed above the scrolling tags. Palette pickup gives light haptic feedback
and a small lift animation (respecting reduced motion); dragged tags retain their text size.
Palette tag pressables have symmetric padding around the visible pill, with wider horizontal
touch space. The in-flight tag has no background backing it.

The palette initially occupies 268 points plus its safe-area inset. Search fields stay visible
with outlined, transparent surfaces. A floating compatibility player adds
its bottom inset; the native iOS accessory already shortens the screen and adds no palette height. Its drag handle
resizes up to 420 points. The collapsed minimum uses the platform-specific tab/player inset,
leaving the Your tags heading just above the floating bottom bar. Tapping Your tags collapses/expands it; accessibility increment
and decrement actions do the same. Only the current drag target is highlighted. The
collapsed state clips the tag viewport and hides its actions from accessibility while keeping
the content mounted for continuous resizing. Empty user tags link
to Library and explain that suggestions can be enabled in settings.
The tag list has enough bottom scroll space to bring its final row to the top of the list.

CadenzaScreen renders a subdued fixed nebula behind the workspace and glass cards. In Simple,
the condition scroller passes beneath the fixed heading, whose background fades from the theme
background into transparency over the cards.
Colors come from the user's most-used tags, independent of query edits. The palette has its own
glass surface with outlined search fields above it. Conditions put the small grip, slider,
requirement wording, and trash in a compact header.
Tags sit directly below, using the same pill size as the palette, with the optional diagram at bottom right. Blank workspace remains an append drop target. Cadenza puts the compact outer slider inside the wrapping heading sentence.
The palette has one search field and, when enabled, shows basic, suggested, advanced value,
and metadata tags in that order. The optional sections have compact headings and divider rules.
Query settings can hide advanced or metadata tags without changing a query that already uses them.
The empty workspace has a single hint, and zero results do not add a helper paragraph.

## Drag contracts

- Palette and query tags use gesture-handler pans for drag, plus a tap action for selection or
  removal. Sliders and trash buttons own their separate interactions.
- Condition pans are handle-only; the rest of each card stays available to scroll and controls.
- Drag coordinates use Reanimated shared values. React updates on target changes, not each frame.
- Drop rectangles are measured when a drag starts. Scrolling during a drag can stale the cache.
- Condition reordering keeps the list's measured geometry fixed during a gesture, as the player
  queue does. A window-level ghost follows the finger, the source card stays in its slot but is
  hidden, and only intervening rows translate to preview the destination. On release, the order
  commits once and the keyed rows animate to their final positions. No source-height collapse or
  destination spacer changes the measurements used to choose the drop index. PortalHost reparents
  the ghost, so DragGhost explicitly bridges drag and editor-action contexts.
- Idle cards keep natural height. Only an active drag freezes measured width/height. Release must
  restore auto height and retain the synchronous latch through gesture finalization.
- Avoid dynamically switching NativeWind shadow or alpha utilities on these controls; use inline
  dynamic styles to avoid the existing native navigation-context failure.

## Results and scope

The shared results action is a content-width glass button with a right arrow, floating above
the palette. It follows palette resizing and hides during dragging to leave drop targets clear.
Its contents dim when disabled. Undo and Redo share a glass capsule on iOS and use separate glass
circles on Android. Their icons are muted when unavailable, and they can be hidden in query settings.
Scroll padding keeps the last card reachable above it. The Advanced/Simple switch is in the
header beside settings. The bubble replaces the old preview overlay. An empty query sends
no request. Counts come from backend IDs without waiting for MusicKit metadata. Results navigation
preserves the editor. The full results route uses TrackCollectionView, resolves tracks, supports
play/shuffle/queue, and records query playback. Save Query opens a name dialog and logs the
request until persistence is implemented.

Include suggested tags lives in the header settings and applies to both editors. The setting
cannot turn off while either draft contains a suggested-tag reference. The screen owns this guard,
the suggested tag registry, and undo; see `../cadenza/README.md`.

## Validation

`QueryUtils.test.ts` covers editing invariants, value predicates, and legacy wire shapes. `QueryConversion.test.ts`
checks truth tables across all group modes and outer operators, reorder invariance, lossless
round trips, and rejection of unsupported conversion. Workspace history tests live in Cadenza.
Run these and the advanced-builder tests after changes to semantics or conversion.

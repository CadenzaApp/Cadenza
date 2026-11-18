# cadenza

The Cadenza tab owns Simple and Advanced query drafts, matching scope, history, and results
navigation. Tags are managed in Library. Queries run over the last synced music library.

## Entry points

- `CadenzaScreen.tsx`: tag reads, stable tag-colored nebula with the Cadenza note blurred over it, wrapping query heading, header
  controls, result count, and results navigation.
- `query-workspace.ts`: pure draft transitions and bounded history. `query-workspace-store.ts`
  holds them for the signed-in account outside the screen, and `use-query-workspace.ts` binds the
  store to the screen. `use-tag-placement.ts` owns pending placement and cancellation.
- `query-settings.ts`: device-local preferences, held in memory outside the screen and saved to
  the device. `readQuerySettings()` reads them from anywhere, loading the saved ones first.
- `query-controls.tsx`: settings dialog/tooltips and history buttons.
- [../query-builder/README.md](../query-builder/README.md): Simple gestures and wire semantics.
  Advanced's tree and validation live in `../advanced-query-builder`.

## Drafts and history

Drafts live in `query-workspace-store.ts` for the app run, outside the screen, so something other
than the tab (the assistant) can load a query into them. They belong to one account: another
signed-in account starts with empty drafts. The first switch to Advanced seeds it from Simple
only if Advanced has no existing state. Later switches preserve both drafts, including an
intentionally emptied Advanced draft. Switching back never converts Advanced into Simple.
Switching is silent navigation and creates no undo step.

Each editor has its own 20-edit history. Consecutive value typing coalesces within 1500ms.
Snapshots retain only the active draft; unchanged edits preserve references instead of serializing
both trees. Undoing in one editor cannot replace the other's draft.

`load` replaces the whole query from outside, maybe in the other editor, as one undo step that
holds both drafts and the editor that was open. Undoing it brings all three back and switches
editors if the load did; redo puts the loaded query back.

Settings are not part of history. Changing one is never an undo step, and undo and redo leave
them as they are, except that a restored draft holding a suggested tag turns Include suggested
tags on, since the tag only matches with it.

## Preferences and results

All six settings persist across launches: library or tagged songs, Venn diagrams, Undo/Redo,
suggested tags, advanced tags, and metadata tags. Library or tagged and metadata are off by default.
Library or tagged (saved as `libraryOrTagged`, carried over from the old `libraryOnly`) sends
`library_or_tagged` with both the count and `/query-results` (as its `library` param), so a query
matches only songs in the user's library or carrying one of their own tags, and is never capped. Suggested visibility also controls
`consider_default_tags` for both editors and cannot turn off while either draft references a
suggested tag. Remembered suggestions remain identifiable after seeding or undo.
Each setting has a tap-triggered tooltip. Hiding palette sections never removes query filters.

The untinted glass results button uses backend IDs without loading artwork/playable metadata.
A query runs over every song Cadenza knows, not just the library, so the count reads `999+ results`
from 1000 matches up, and whenever the backend capped the songs from outside the user's own at 1000.
Empty/incomplete queries do not submit; failed requests offer SWR retry. Opening `/query-results`
passes the query, matching scope, relevant tags, and analytics description while preserving drafts.
That route resolves playable tracks and records query playback. Its "..." menu has Favorite, Play
next, Add to queue, and Save query, which stores the query, its flags, its cover, and the songs it
matches now; it then shows under Queries in the Library tab. Opened from there (`saved` param), the
screen shows the stored songs, and the menu offers Rerun query in place of Save.

Clear sits beside the heading. Undo/Redo share a capsule on iOS and remain separate on Android;
unavailable actions dim. Simple's floating actions follow the palette. Advanced's sit above
the navigation/player inset. Scroll clearance keeps the final condition reachable.

# cadenza

The Cadenza tab owns Simple and Advanced query drafts, matching scope, history, and results
navigation. Tags are managed in Library. Queries run over the last synced music library.

## Entry points

- `CadenzaScreen.tsx`: tag reads, stable tag-colored nebula, wrapping query heading, header
  controls, result count, and results navigation.
- `query-workspace.ts`: pure draft transitions and bounded history; `use-query-workspace.ts`
  binds them to React. `use-tag-placement.ts` owns pending placement and cancellation.
- `query-settings.ts`: device-local preference persistence and lifecycle.
- `query-controls.tsx`: settings dialog/tooltips and history buttons.
- [../query-builder/README.md](../query-builder/README.md): Simple gestures and wire semantics.
  Advanced's tree and validation live in `../advanced-query-builder`.

## Drafts and history

Drafts last for the mounted tab's lifetime. The first switch to Advanced seeds it from Simple
only if Advanced has no existing state. Later switches preserve both drafts, including an
intentionally emptied Advanced draft. Switching back never converts Advanced into Simple.
Switching is silent navigation and creates no undo step.

Each editor has its own 20-edit history. Consecutive value typing coalesces within 1500ms.
Snapshots retain only the active draft; unchanged edits preserve references instead of serializing
both trees. Undoing in one editor cannot replace the other's draft.

## Preferences and results

All five settings persist across launches: Venn diagrams, Undo/Redo, suggested tags, advanced
tags, and metadata tags. Metadata is off by default. Suggested visibility also controls
`consider_default_tags` for both editors and cannot turn off while either draft references a
suggested tag. Remembered suggestions remain identifiable after seeding or undo.
Each setting has a tap-triggered tooltip. Hiding palette sections never removes query filters.

The untinted glass results button uses backend IDs without loading artwork/playable metadata.
Empty/incomplete queries do not submit; failed requests offer SWR retry. Opening `/query-results`
passes the query, matching scope, relevant tags, and analytics description while preserving drafts.
That route resolves playable tracks and records query playback. Save Query logs the name only.

Clear sits beside the heading. Undo/Redo share a capsule on iOS and remain separate on Android;
unavailable actions dim. Simple's floating actions follow the palette. Advanced's sit above
the navigation/player inset. Scroll clearance keeps the final condition reachable.

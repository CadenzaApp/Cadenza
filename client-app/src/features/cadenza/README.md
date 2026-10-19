# cadenza

The Cadenza tab owns Simple and Advanced query drafts, matching scope, and internal edit history.
Tags are managed in Library; this tab builds queries over the user's synced music library.

## Entry points

- `CadenzaScreen.tsx`: tag reads, the stable tag-colored nebula, header settings, result count,
  editor switching, and results navigation.
- `query-workspace.ts`: a bounded 15-edit history per editor for query changes. Switching
  editors is navigation and does not create an undo step. No-op edits are ignored.
- `query-settings.ts`: device-local persistence for suggested tags, Venn diagrams, Undo/Redo,
  advanced value tags, and metadata palette visibility.
- `../query-builder/QueryConversion.ts`: lossless conversion between the editors' supported forms.

## Query flow

Simple has one outer All groups / Any group rule. Every edit normalizes the condition connectors
so reordering is presentational. Inside a group, ANY / ALL / NONE still means OR / AND / NOT OR.
With multiple groups, the heading reads "Find me all songs that satisfy [ALL/ANY] of the
following:". Its words and compact slider wrap together. Tapping an AND/OR divider toggles
the same global rule.

Opening Advanced carries the current simple query across. Returning to Simple converts supported
tag and metadata predicates and flat tag groups when possible. Unsupported fields,
nesting, unavailable tags, and invalid predicates are never silently dropped. When conversion
is not possible, the user can open the previous simple draft and keep the advanced draft. Opening
Advanced then offers Resume or Use current simple query. Replacing a separate draft requires the explicit Use current simple query action.
Simple constructs conditions by drag and drop or tap placement, with a predicate popup for value
tags, and metadata fields using the same predicate popup. Advanced also supports cross-tag fields.

Both editors compile to the shared QueryJSON format and use `useQueryResults`. The result button
uses the backend ID count directly; the editor does not load MusicKit track metadata or artwork.
Empty, incomplete, pending, zero-match, and failed queries have distinct result states. Retry uses
SWR's mutate. Opening results pushes `/query-results` with
the query, matching scope, relevant tags, and its analytics description. Closing results preserves
both drafts. The results route owns resolving matched IDs into playable tracks.

## Suggested tags

The header editor switch sits beside settings, before Account.
This setting reveals the simple palette's suggestions and sets `consider_default_tags` for both
editors. Suggested tags encountered in Simple retain their identity when converted to Advanced.
Advanced only offers remembered suggested tags while the setting is enabled.

The setting cannot be switched off while either draft explicitly references a suggested tag.
An info button beside each setting opens a tap-triggered popover over the settings. The
suggested-tag explanation also explains how to remove required references. Turning the setting
off never clears a query.
Settings also controls diagram visibility for all simple cards, including singles.
One search field filters the palette's basic, suggested, advanced, and metadata sections.
The metadata section is off by default. All five query settings persist across
app launches. Clear sits beside the heading. Undo and Redo appear in the floating left action
area when enabled, dimmed when unavailable. iOS combines them in one glass capsule; Android
keeps separate buttons. The untinted glass results button floats on the right at
the same height. Simple places these above the resizable palette; Advanced places them above
the bottom navigation/player inset.

## Limits

Drafts and internal history last for the mounted tab's lifetime. Query settings persist on device.
The backend evaluates `user_songs`, so results depend on the last successful library sync.
The full results page has a Save Query name dialog. Saving currently logs the requested name
and does not persist a query.

Touching this directory? Keep this README accurate with the final change.

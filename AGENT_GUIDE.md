# Agent guide

Shared instructions for any coding agent working in this repo. `CLAUDE.md` and `AGENTS.md`
both point here. Tool-specific instructions go in those files, below the pointer.

## What Cadenza is

A music app built on Apple Music. Users tag songs in their library, then build boolean tag
queries (and / or / not, by drag and drop) to pull a playlist back out. Tags can also be
suggested by an LLM.

Two halves:

- `client-app/` - Expo / React Native app, expo-router, nativewind. Runs on iOS and Android.
  Talks to Apple Music through a local native Expo module, and to our own backend for tags
  and queries.
- `backend-api/` - Rust, axum 0.8 + SeaORM 2.0 over Supabase postgres. Owns tags, tag
  application, the query engine, and LLM tag generation. Auth is Supabase JWT, verified
  against Supabase's JWKS.

Apple Music owns song metadata and playback. We only ever store a song id (a string) and the
tags attached to it. Thus the backend never knows a song title.

## Repo map

```
backend-api/            rust api
  src/main.rs           AppState + router nesting + BIND_ADDR
  src/auth.rs           SupabaseClaims, JWKS decoder
  src/err.rs            CadenzaError, every handler returns Result<_, CadenzaError>
  src/routes/           http handlers, one module per resource
  src/db/               query layer, src/db/entity/ is generated
  src/services/         tag generation + tag normalization
client-app/             expo app
  src/app/              expo-router routes (tabs, auth, splash, tag detail)
  src/lib/              data layer: swr wrappers, endpoint hooks, providers
  src/features/         self-contained product features
  src/components/       ui/ primitives and custom/ app components
  modules/apple-musickit/  local native Expo module (swift + kotlin + ts)
```

`db-schema/`, `ml-service/`, `shared-spec/`, `infra/` do not exist yet. If a doc or a ticket
mentions them, they are aspirational.

## Feature READMEs

Read the README for the area you are about to touch **before** you start grepping. Each one
gives you the file map, the flow, and the gotchas.

| README | Covers |
| --- | --- |
| [backend-api/README.md](backend-api/README.md) | Backend setup, env vars, `main.rs` wiring, auth, errors |
| [backend-api/src/routes/README.md](backend-api/src/routes/README.md) | Every HTTP endpoint and its request/response shape |
| [backend-api/src/db/README.md](backend-api/src/db/README.md) | Query layer, the tag schema, the boolean query compiler |
| [backend-api/src/services/README.md](backend-api/src/services/README.md) | LLM tag generation, the `TagGenerator` trait, tag normalization |
| [client-app/README.md](client-app/README.md) | Client setup, env vars, path aliases, scripts |
| [client-app/src/app/README.md](client-app/src/app/README.md) | expo-router layout, provider nesting, the five tabs |
| [client-app/src/lib/README.md](client-app/src/lib/README.md) | SWR wrappers, endpoint hooks, the four providers |
| [client-app/src/components/README.md](client-app/src/components/README.md) | `ui/` vs `custom/`, and which one gets new code |
| [client-app/src/components/custom/media-player/README.md](client-app/src/components/custom/media-player/README.md) | The global player surface |
| [client-app/src/features/query-builder/README.md](client-app/src/features/query-builder/README.md) | The drag and drop boolean query tree |
| [client-app/modules/apple-musickit/README.md](client-app/modules/apple-musickit/README.md) | Native Apple Music auth, catalog, library, playback, mock mode |

## Keeping the READMEs current

This is the point of the whole system. A stale README is worse than no README, because the
next agent trusts it.

- Read the directory's `README.md` before working in it. Do not grep first.
- If you change files in a directory that has a `README.md`, update that README **in the same
  change**. Not in a follow-up.
- Update it when you add, remove, or rename a file; change a route path, request shape, or
  response shape; change how data flows between the files; add or remove an env var; or change
  a public export.
- Do not update it for an internal refactor that leaves the file list, the contracts, and the
  flow unchanged.
- Keep them map-level. They exist so the next agent does not have to grep. They are not API
  reference and they do not restate code.
- If a README disagrees with the code, the code wins. Fix the README as part of your change and
  say so in your summary.
- New directory that is its own area of concern? Add a `README.md` using the same five sections
  the others use, and add a row to the table above.

## Backend conventions

- Handlers stay thin. Business logic goes in `src/db/` or `src/services/`, never in the route.
- New route module: add `pub mod x;` to `src/routes/mod.rs`, write `get_x_router()`, nest it in
  `main.rs`.
- Everything user scoped goes through `Claims<SupabaseClaims>` and then `claims.user_id`. Never
  take a user id from a request body or a query param.
- Every handler returns `Result<_, CadenzaError>`. Add a variant to `src/err.rs` rather than
  returning a bare status code.
- `src/db/entity/` is generated by sea-orm-codegen. Do not hand edit it. Schema changes start as
  a SQL migration, then regenerate.
- Types that cross the API boundary live in `src/routes/json/`, separate from the entity models.
- Doc comments say what a thing returns, with a JSON example when it returns JSON. Match the
  style in `src/routes/queries.rs`.

## Client conventions

- Path aliases: `@/*` is `client-app/src/*`, `@apple-musickit` is the local native module.
- Styling is nativewind (`className`), not `StyleSheet`, for anything new. Some older files mix
  both; do not spread that.
- Screens go in `src/app/`. Anything with real logic belongs in `src/features/` or `src/lib/`,
  and the screen just wires it up.

### SWR and data fetching

- Prefer SWR for hooks that read idempotent asynchronous data from the backend, Apple Music, or
  another remote source, especially when multiple components may request the same data or
  benefit from cached loading, error, and revalidation state.
- Reuse the wrappers in `src/lib/swr-utils.ts`, the endpoint hooks in `src/lib/routes/`, and the
  MusicKit hooks in `src/lib/musickit-hooks.ts` before introducing another fetching pattern.
- Make every cache key stable and complete. Include all parameters that can change the response,
  such as ids, query text, filters, limits, and resource types. Use a `null` key when required
  inputs or authorization are unavailable.
- Return SWR's data, loading, and error state from read hooks instead of duplicating them with
  `useState` and `useEffect`.
- Use `useSWRMutation` or the existing mutation wrappers for user-triggered writes. Invalidate or
  update every affected read key. Use optimistic updates only when rollback behavior is defined.
- Do not use SWR for local presentation state, playback commands, animation state, or
  subscriptions to continuously changing native or external stores. Keep one-off imperative work
  imperative when its result is not reusable cached data.
- Before adding a manual fetch effect, check whether it is an idempotent read. If it is, default
  to an SWR-backed hook unless lifecycle or consistency requirements make SWR unsuitable, and
  document that exception briefly.

## Writing style for docs and comments

Plain ASCII only. No em dashes, no smart quotes, no emoji. Short sentences. Say what a thing
does, not how impressive it is. Match the tone of the existing docs.

# backend-api

Rust HTTP api for Cadenza. Owns tags, tag application, the boolean query engine, and LLM tag
suggestion. axum 0.8 for routing, SeaORM 2.0 over Supabase postgres, auth by verifying Supabase
JWTs against Supabase's JWKS.

It does not store song metadata. A song is just an id string that came from Apple Music.

## Files

| file | role |
| --- | --- |
| `src/main.rs` | Builds `AppState`, nests the routers, binds the listener. |
| `src/auth.rs` | `SupabaseClaims` and `new_jwt_decoder()`, which fetches Supabase's JWKS once at startup. |
| `src/err.rs` | `CadenzaError` and its status code / JSON body mapping. |
| `src/routes/` | HTTP handlers. See [src/routes/README.md](src/routes/README.md). |
| `src/db/` | Query layer and generated entities. See [src/db/README.md](src/db/README.md). |
| `src/services/` | Tag generation and normalization. See [src/services/README.md](src/services/README.md). |
| `src/test_utils.rs` | Test helpers. Currently just `string_of_length`. |
| `certs/readme.md` | Leftover self-signed cert steps. No longer needed, the server is plain HTTP. |

## How it works

`main.rs` loads `.env`, opens the db connection, builds the JWKS decoder, constructs the tag
generation service, and packs all three into `AppState`. `AppState` derives `FromRef`, so a
handler can extract just the piece it needs:

```rust
State(db): State<DatabaseConnection>
State(tag_gen_service): State<TagGenerationService>
```

Three routers get nested, plus a health route:

```
/tags      get_tags_router()
/songs     get_songs_router()
/queries   get_queries_router()
/test      returns "server is reachable"
```

Auth is per handler, not middleware. A handler that needs a user adds
`Claims { claims, .. }: Claims<SupabaseClaims>` to its arguments, and `axum-jwt-auth` rejects
the request with a 401 before the body runs. The user id is `claims.user_id`, taken from the
JWT `sub`. Never read a user id off the request.

Errors: every handler returns `Result<_, CadenzaError>`. `CadenzaError` implements
`IntoResponse` and maps each variant to a status plus a JSON body of
`{ "error_type": ..., "message": ... }`. 401 and 422 are the exceptions and come back without
that shape.

## Environment

`backend-api/.env`, gitignored:

| var | required | notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres`. Panics at startup if missing. |
| `OPENAI_API_KEY` | yes | Read by `OpenAiTagGenerator::new()`, which panics at startup if missing, even if you never call tag suggestion. |
| `BIND_ADDR` | no | Defaults to `127.0.0.1:3000`, which is loopback only. Set `0.0.0.0:3000` to accept connections from a phone or another machine on the LAN. Panics if it does not parse as `host:port`. |

The Supabase project ref and publishable key are hardcoded in `src/auth.rs`. They are public
values, not secrets.

## Running

```sh
cargo run --release
cargo test
```

Rebuilding db entities after a schema change:

```sh
cargo install sea-orm-cli@^2.0.0-rc
sea-orm-cli generate entity -o ./src/db/entity --entity-format dense
```

## Connects to

- `client-app/src/lib/swr-utils.ts` is the client's only general path in here. It attaches
  `Authorization: Bearer <supabase jwt>` to every call.
- `client-app/src/features/query-builder/QueryUtils.ts` posts to `/queries` directly.
- OpenAI's responses api, from `src/services/tag_generation/openai_tag_generator.rs`.

## Gotchas

- The server is plain HTTP. The cert instructions in `README` history and `certs/readme.md` are
  dead; ignore them.
- `OpenAiTagGenerator::new()` panics on a missing `OPENAI_API_KEY` during startup, so you cannot
  boot the api without one even for pure tag CRUD work.
- Startup does a network call to Supabase for the JWKS. Offline, the server will not boot.
- `SupabaseClaims.expiration` is a raw `usize`, not a `DateTime`. Nothing parses it yet.

---
Touching files in this directory? Update this README in the same change.
See [../AGENT_GUIDE.md](../AGENT_GUIDE.md).

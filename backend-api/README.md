# backend-api

Rust HTTP api for Cadenza. Owns tags, tag application, the boolean query engine, LLM tag
suggestion, and comments on songs. axum 0.8 for routing, SeaORM 2.0 over Supabase postgres, auth
by verifying Supabase JWTs against Supabase's JWKS.

It does not store song metadata. A song is just an id string that came from Apple Music. It can
read a song's catalog metadata from Apple Music on demand (`src/services/song_metadata.rs`), but
nothing that comes back is persisted.

## Files

| file | role |
| --- | --- |
| `src/main.rs` | Builds `AppState`, spawns the background jobs, nests the routers, binds the listener. |
| `src/auth.rs` | `SupabaseClaims` and `new_jwt_decoder()`, which fetches Supabase's JWKS once at startup. |
| `src/err.rs` | `CadenzaError` and its status code / JSON body mapping. |
| `src/routes/` | HTTP handlers. See [src/routes/README.md](src/routes/README.md). |
| `src/db/` | Query layer and generated entities. See [src/db/README.md](src/db/README.md). |
| `src/services/` | Tag generation, normalization, Apple Music song metadata, default tag generation, the weekly tag score decay, the social feed proxy, and the listening analytics definitions. See [src/services/README.md](src/services/README.md). |
| `src/test_utils.rs` | Test helpers. Currently just `string_of_length`. |
| `sql/` | The DDL for tables added by hand, so a fresh database can be stood up. Not a migration runner; see Schema changes. |
| `certs/readme.md` | Leftover self-signed cert steps. No longer needed, the server is plain HTTP. |

## How it works

`main.rs` loads `.env`, opens the db connection, builds the JWKS decoder, constructs the tag
generation service, and packs all three into `AppState`. It also spawns the two background jobs,
neither of which is in `AppState` because nothing serving a request talks to them.
`AppState` derives `FromRef`, so a handler can extract just the piece it needs:

```rust
State(db): State<DatabaseConnection>
State(tag_gen_service): State<TagGenerationService>
```

Seven routers get nested, plus a health route:

```
/tags       get_tags_router()
/songs      get_songs_router()
/queries    get_queries_router()
/comments   get_comments_router()
/social     get_social_router()
/events     get_events_router()
/analytics  get_analytics_router()
/test       returns "server is reachable"
```

`/social` is a proxy, not a resource. It forwards whatever path follows to the social feed
service and adds the caller's user id. See [social-feed/README.md](social-feed/README.md).

Auth is per handler, not middleware. A handler that needs a user adds
`Claims { claims, .. }: Claims<SupabaseClaims>` to its arguments, and `axum-jwt-auth` rejects
the request with a 401 before the body runs. The user id is `claims.user_id`, taken from the
JWT `sub`. Never read a user id off the request.

Two `tokio` tasks run for the life of the process, both spawned from `main.rs` before the
listener binds:

- **default tag backfill**, off unless `DEFAULT_TAG_BACKFILL_ENABLED` is `true`, because every
  pass can spend Apple Music and OpenAI calls.
- **tag score decay**, always on. Once a week it halves each user's `tag_scores` in a transaction
  of its own, skipping users whose highest score is below 5, and records each user's last decay
  week in `tag_scores_metadata`. It checks once a day, and a day with nobody due costs one query,
  so there is no env var to turn it off.

Both are in `src/services/`. See [src/services/README.md](src/services/README.md).

Errors: every handler returns `Result<_, CadenzaError>`. `CadenzaError` implements
`IntoResponse` and maps each variant to a status plus a JSON body of
`{ "error_type": ..., "message": ... }`. 401 and 422 are the exceptions and come back without
that shape.

## Environment

`backend-api/.env`, gitignored:

| var | required | notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | The Supabase **session-mode** pooler: `postgresql://postgres.PROJECT:PASSWORD@REGION.pooler.supabase.com:5432/postgres`. Panics at startup if missing. Use port 5432, not 6543; see Database connections below. |
| `OPENAI_API_KEY` | yes | Read by `OpenAiTagGenerator::new()`, which panics at startup if missing, even if you never call tag suggestion. |
| `APPLE_MUSIC_DEVELOPER_TOKEN` | yes | A signed MusicKit developer token, used by `SongMetadataService` to read the song titles default tag generation runs on. Read by `SongMetadataService::new()`, which panics at startup if missing. Apple caps the token at 6 months and nothing here refreshes it. |
| `APPLE_MUSIC_STOREFRONT` | no | Two letter storefront for catalog lookups, e.g. `gb`. Defaults to `us`. A song not released in that storefront reads as missing. |
| `BIND_ADDR` | no | Defaults to `127.0.0.1:3000`, which is loopback only. Set `0.0.0.0:3000` to accept connections from a phone or another machine on the LAN. Panics if it does not parse as `host:port`. |
| `DEFAULT_TAG_BACKFILL_ENABLED` | no | `true` turns on the background job that generates default tags for songs nothing has read yet. Off for any other value, and off when unset, because every pass can spend Apple Music and OpenAI calls. |
| `DEFAULT_TAG_BACKFILL_BATCH_SIZE` | no | Songs one pass covers. Defaults to 50, clamped to 1..=200 so a pass can never reach the 300 id cap `SongMetadataService` panics past. An unparseable value falls back to the default. |
| `DEFAULT_TAG_BACKFILL_INTERVAL_SECS` | no | Seconds between passes. Defaults to 300. Zero and unparseable values fall back to the default, since a zero interval would spin the loop. A pass OpenAI rate limited waits a fixed 300 seconds instead, however short this is. |
| `SOCIAL_FEED_URL` | no | Base url of the social feed service that `/social/*` forwards to. Defaults to `http://localhost:3001`. A trailing slash is trimmed. The service has no auth, so this must stay on a private address. |

### Database connections

`main.rs::db_connect_options` caps the pool at `MAX_DB_CONNECTIONS`. That cap is the point of the
function: Sea-ORM defaults to 100 connections, and the pooler serves far fewer, so the default
exhausts it and every later connect fails with `(EMAXCONNSESSION) max clients reached`.

Use the **session-mode** port (5432). Transaction mode (6543) multiplexes clients across fewer
server connections and would survive a crash better, but it breaks sqlx's named prepared
statements: two client connections land on one server connection and the second gets
`prepared statement "sqlx_s_1" already exists`. Setting `statement-cache-capacity=0` does not
save it, because the name collides across clients rather than within one. The queries in
`src/db/` are prepared statements, so the app needs session mode.

The cost of session mode is that each client pins a server connection for its whole life. A
backend killed with SIGKILL leaves its connections pinned until the pooler reaps them, which
takes minutes, and until then a restart cannot get a slot. `idle_timeout` and `max_lifetime`
keep a **running** backend from hoarding them; neither helps a process that never got to clean
up. If a restart fails with `EMAXCONNSESSION`, either wait for the reap or look at what is
holding them:

```sh
psql "$(grep ^DATABASE_URL .env | cut -d= -f2- | sed 's/:5432\//:6543\//')" \
  -c "select state, count(*) from pg_stat_activity where usename = current_user group by state;"
```

That inspection query goes through 6543 on purpose. It is a single simple query with no prepared
statement, so transaction mode is fine for it, and it still connects when 5432 is full.

The Supabase project ref and publishable key are hardcoded in `src/auth.rs`. They are public
values, not secrets.

## Running

```sh
cargo run --release
cargo test
```

Rebuilding db entities after a schema change:

```sh
cargo install sea-orm-cli@2.0.0-rc.37 --locked
sea-orm-cli generate entity -o ./src/db/entity --entity-format compact
```

Keep the CLI version equal to the `sea-orm` version in `Cargo.lock`. The stable 2.0.0 CLI writes
code this crate cannot compile: `rs_type = "Enum"` on Postgres enums, and `BelongsTo` relation
fields in the dense format.

## Schema changes

There is no migration runner. SeaORM entities are generated **from** the live database, so the
schema has to change first and the entities are regenerated after.

The schema was built by applying SQL to Supabase by hand. Keep doing that, but leave the SQL in
`sql/` so it is reviewable and a fresh database can be stood up:

```sh
psql "$(grep ^DATABASE_URL .env | cut -d= -f2-)" -v ON_ERROR_STOP=1 -f sql/your_change.sql
sea-orm-cli generate entity -o ./src/db/entity --entity-format compact
```

Write the DDL so it can be run twice (`create table if not exists`, `create index if not exists`),
and keep it additive. Supabase turns row level security **on** for every new table, and nothing
else in this schema has it on, so a new table needs
`alter table x disable row level security` or any role that is not the owner silently reads
nothing. `sql/listening_events.sql` is the worked example.

Not everything in the database is in `sql/` yet: tables and columns added before this directory
existed, `tags.is_activity` among them, live only in Supabase.

## Connects to

- `client-app/src/lib/api-actions.ts` is the client's only path in here. It attaches
  `Authorization: Bearer <supabase jwt>` to every call, and `client-app/src/lib/routes/` mirrors
  this crate's `src/routes/` one to one.
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

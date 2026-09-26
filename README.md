# Cadenza

Tag your music, then query it.

Cadenza sits on top of Apple Music. You tag songs in your library however you want (`gym`,
`sad`, `driving at night`), then build a boolean query out of those tags by dragging them
together, and get a playlist back. Tags can also be suggested for you by an LLM.

## How it fits together

```
  Apple Music  <---- native module ----  Expo app  ---- HTTP + JWT ---->  Rust api
  (metadata,                          (client-app)                      (backend-api)
   playback)                                                                  |
                                                                              v
                                                                     Supabase postgres
                                                                   (tags, tags applied)
```

Apple Music owns song metadata and playback. The backend only stores song ids and the tags on
them, so it never sees a song title.

## Layout

| Directory | What it is |
| --- | --- |
| `backend-api/` | Rust api. axum 0.8, SeaORM 2.0, Supabase postgres, Supabase JWT auth. |
| `client-app/` | Expo / React Native app. expo-router, nativewind, SWR. |
| `client-app/modules/apple-musickit/` | Local native Expo module wrapping Apple MusicKit (Swift + Kotlin), with a mock mode for development without a subscription. |
| `.githooks/` | Versioned Git hooks, including the pre-push formatting check. |

## Running it

Backend:

```sh
cd backend-api
cargo run --release
```

Needs `backend-api/.env` with `DATABASE_URL` and `OPENAI_API_KEY`. See
[backend-api/README.md](backend-api/README.md).

Client:

```sh
cd client-app
npm install
npm run ios       # or: npm run android
```

Needs `client-app/.env`. See [client-app/README.md](client-app/README.md).

The two default to different hosts depending on how you run them, and a phone cannot reach
`localhost` on your machine. Both READMEs cover that.

## Formatting before push

Install the repository pre-push hook once per clone. It checks Rust and client formatting before
every push, keeping the code tidy and merge conflicts smaller.

```sh
./scripts/install-git-hooks.sh
```

On Windows, run `scripts\install-git-hooks.bat`. If the hook blocks a push, run
`./scripts/format.sh` on macOS or Linux, or `scripts\format.bat` on Windows, then review and
commit the generated formatting changes.

## Docs

Selected stable areas have short READMEs when setup, contracts, or gotchas need explanation.
Start from [AGENT_GUIDE.md](AGENT_GUIDE.md), which lists the relevant ones and the project's
documentation policy. That file is also the shared brief for coding agents, which `CLAUDE.md`
and `AGENTS.md` both point at.

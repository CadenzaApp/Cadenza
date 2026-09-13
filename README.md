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

## Docs

Every significant directory has a `README.md` describing its files, flow, and gotchas. Start
from [AGENT_GUIDE.md](AGENT_GUIDE.md), which indexes all of them. That file is also the shared
brief for coding agents, which `CLAUDE.md` and `AGENTS.md` both point at.

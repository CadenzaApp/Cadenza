# social-feed

Ranks posts for a user's feed from the genres and artists they listen to. FastAPI + psycopg,
run as its own process next to `backend-api`.

Nothing here has auth. It takes `user_id` as data, so it must never be reachable from the
outside. The Rust api is the only client: `backend-api/src/routes/social.rs` proxies
`/social/*` here and stamps the user id from the verified JWT. See
[../src/services/README.md](../src/services/README.md).

## Setup

Needs [uv](https://docs.astral.sh/uv/) and python 3.13+.

```
uv sync
uv run fastapi dev main.py --port 3001
```

Port 3001 is what `SOCIAL_FEED_URL` defaults to on the api side.

`social-feed/.env`, gitignored:

| var | required | notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Same Supabase postgres the api uses. Read on every request, one connection per request. |
| `HF_TOKEN` | yes | Hugging Face token for `google/embeddinggemma-300m`, which is gated. Read at import, so the process will not start without it. |

First start downloads the model, so it is slow and needs a few hundred MB.

## Endpoints

| endpoint | body / query | returns |
| --- | --- | --- |
| `GET /feed` | `user_id`, optional `exclude=none\|loaded\|viewed` (default `none`) | `{"feed": [{post_id, content, likes, liked, created_at, author: {user_id, username}}, ...]}`, at most `FEED_SIZE` (10), ranked. Marks returned ids as `loaded` in `post_view_status` (insert only; never downgrades `viewed`). `liked` is whether this user has a `post_likes` row |
| `PATCH /interests/update` | `user_id`, `delta_scores: [{name, itype, delta}]` | nothing |
| `PATCH /interests/decay` | `user_id` | nothing |
| `POST /posts` | `user_id`, `content` (at most 500 characters) | `{"post_id": n}` |
| `GET /posts/user/{author_id}` | `user_id` (viewer, for liked) | `{"profile": {user_id, username, bio}, "posts": [...]}`, that author's posts newest first (same post shape as `/feed`). Missing profile uses username `"unknown"` and an empty bio |
| `POST /posts/{post_id}/likes` | `user_id`, `timestamp` (client ms) | nothing |
| `DELETE /posts/{post_id}/likes` | `user_id`, `timestamp` (client ms) | nothing |
| `POST /posts/views` | `user_id`, `post_ids: [n, ...]` | nothing. Sets `post_view_status` to `viewed` (insert or upgrade from `loaded`) |

`itype` is `genre` or `artist`.

### `exclude` on `/feed`

| value | filter |
| --- | --- |
| `none` | no `post_view_status` filter |
| `viewed` | no row with `status = viewed` |
| `loaded` | no `post_view_status` row at all |

Progression per user/post: (no row) → `loaded` (when `/feed` returns the post) → `viewed` (client after ~2s on screen).

The client loads the first page with `exclude=viewed`, later pages with `exclude=loaded`, then
`exclude=none` after never-loaded posts run out.

## How ranking works

- `interests` holds one row per `(name, interest_type)` with a pgvector embedding, shared by
  every user. `interest_scores` holds each user's score per interest.
- A score update embeds any interest that has no embedding yet, then adds the delta. Embedding
  only ever happens on a name nothing has embedded before.
- The user vector is the top 10 genres and top 10 artists, each embedding times its score,
  summed. No scores means no vector, which means an empty feed.
- `get_feed` unions posts nearest the user vector with the globally hot posts (after `exclude`),
  dedupes, then scores each by likes, age, and cosine similarity.
- `decay_interests` multiplies every score by 0.6. It is a no-op if the user decayed in the
  last 6 hours or their top score is under 5, so the client can call it on every launch. The
  client does, from `@/lib/interest-decay`.

## Gotchas

- `hot_score` is only recomputed in `like_post`, so a post's age stops counting until the next
  like. `get_feed` rescores by age itself, `hot_posts` does not.
- The embedding model loads at import, once per process. Keep it a single worker.
- `psycopg` connections are opened per call and closed by the `with` block. There is no pool.

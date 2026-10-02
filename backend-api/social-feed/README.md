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
| `GET /feed` | `user_id` | `{"feed": [[score, post_id], ...]}`, at most 100 |
| `PATCH /interests/update` | `user_id`, `delta_scores: [{name, itype, delta}]` | nothing |
| `PATCH /interests/decay` | `user_id` | nothing |
| `POST /posts` | `user_id`, `content` | `{"post_id": n}` |
| `POST /posts/{post_id}/likes` | `user_id` (unused) | nothing |

`itype` is `genre` or `artist`.

## How ranking works

- `interests` holds one row per `(name, interest_type)` with a pgvector embedding, shared by
  every user. `interest_scores` holds each user's score per interest.
- A score update embeds any interest that has no embedding yet, then adds the delta. Embedding
  only ever happens on a name nothing has embedded before.
- The user vector is the top 10 genres and top 10 artists, each embedding times its score,
  summed. No scores means no vector, which means an empty feed.
- `get_feed` unions posts nearest the user vector with the globally hot posts, dedupes, then
  scores each by likes, age, and cosine similarity.
- `decay_interests` multiplies every score by 0.6. It is a no-op if the user decayed in the
  last 6 hours or their top score is under 5, so the client can call it on every launch. The
  client does, from `@/lib/interest-decay`.

## Gotchas

- `hot_score` is only recomputed in `like_post`, so a post's age stops counting until the next
  like. `get_feed` rescores by age itself, `hot_posts` does not.
- The embedding model loads at import, once per process. Keep it a single worker.
- `psycopg` connections are opened per call and closed by the `with` block. There is no pool.

# ml-service

Sentence-transformer calls for the social feed. FastAPI, run as its own process
next to `backend-api`. It does not connect to the database. The Rust api loads
the rows and sends whatever the model needs: post or interest text for
`/embedding`, and the user vector plus stored post embeddings for
`/posts/similarities`.

Nothing here has auth. Keep it on a private address. The only client is
`SocialFeedService` in
[../src/services/social_feed.rs](../src/services/social_feed.rs).

## Setup

Needs [uv](https://docs.astral.sh/uv/) and python 3.13+.

```
uv sync
uv run fastapi dev main.py --port 3001
```

Port 3001 is what `SOCIAL_FEED_URL` defaults to on the api side.

`ml-service/.env`, gitignored:

| var | required | notes |
| --- | --- | --- |
| `HF_TOKEN` | yes | Hugging Face token for `google/embeddinggemma-300m`, which is gated. Read at import, so the process will not start without it. |

First start downloads the model, so it is slow and needs a few hundred MB.

## Endpoints

| endpoint | body | returns |
| --- | --- | --- |
| `POST /embedding` | `content` (a post), and/or `interests: [{name, itype}]` | `{embedding, interest_embeddings}`. `embedding` is omitted when `content` is. `itype` is `genre` or `artist` |
| `POST /posts/similarities` | `user_vector: [float]`, `posts: [{post_id, embedding}]` | `{similarities: [{post_id, similarity}]}` |

`/embedding` uses `encode_document` for a post and `encode_query` for an
interest, with the prefix `the music genre ` or `the music artist `.

`/posts/similarities` takes the user vector the Rust api already built and
returns cosine similarity against each stored post embedding. An empty user
vector scores every post at 0.

The Rust api stores the vectors. Nearest-post lookup and likes, views, and
ranking all happen there. This process only runs the model.

## Gotchas

- The embedding model loads at import, once per process. Keep it a single worker.

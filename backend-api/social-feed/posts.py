import math
from datetime import date, timedelta
from threading import Lock

import numpy as np
from cachetools import LRUCache
from sentence_transformers import SentenceTransformer

from interests import *
from util import *


# todo: in the future, include post tags in the text to embed
def post_embedding(model: SentenceTransformer, content: str) -> np.ndarray:
    return model.encode_document(content)


POSTS_EPOCH = datetime(year=2026, month=1, day=1, tzinfo=UTC)

# Last accepted like or unlike, keyed by (user id, post id). A click whose
# timestamp is older than the stored one is ignored. 2000 entries, this process only.
_like_interactions: LRUCache = LRUCache(maxsize=2000)
_like_interactions_lock = Lock()


def accept_like_interaction(user_id: str, post_id: int, timestamp: int) -> bool:
    key = (user_id, post_id)
    with _like_interactions_lock:
        previous = _like_interactions.get(key)
        if previous is not None and timestamp < previous:
            return False
        _like_interactions[key] = timestamp
        return True


def forget_like_interaction(user_id: str, post_id: int, timestamp: int):
    """Drops a timestamp if a newer click has not already replaced it."""
    key = (user_id, post_id)
    with _like_interactions_lock:
        if _like_interactions.get(key) == timestamp:
            del _like_interactions[key]


def create_post(model: SentenceTransformer, user_id: str, content: str):
    with db_conn() as conn, conn.cursor() as cur:
        embedding = post_embedding(model, content)

        days_since_epoch = (datetime.now(UTC) - POSTS_EPOCH).days
        embedding_w_bday = np.append(days_since_epoch, embedding)

        row = cur.execute(
            """
                INSERT INTO posts (user_id, content, embedding, embedding_w_bday)
                VALUES (%s, %s, %s, %s)
                RETURNING post_id
            """,
            (
                user_id,
                content,
                embedding_to_str(embedding),
                embedding_to_str(embedding_w_bday),
            ),
        ).fetchone()
        if row:
            return row["post_id"]


def like_post(user_id: str, post_id: int):
    with db_conn() as conn:
        inserted = conn.execute(
            """
                INSERT INTO post_likes (post_id, user_id)
                VALUES (%s, %s)
                ON CONFLICT (post_id, user_id) DO NOTHING
                RETURNING post_id
            """,
            (post_id, user_id),
        ).fetchone()
        if inserted is None:
            return

        conn.execute(
            """
                UPDATE posts
                SET
                    likes = likes + 1,
                    hot_score =
                        10 * LOG(2, likes + 1) +
                        (created_at::date - '1970-01-01'::date)
                WHERE post_id = %s
            """,
            (post_id,),
        )


def unlike_post(user_id: str, post_id: int):
    with db_conn() as conn:
        deleted = conn.execute(
            """
                DELETE FROM post_likes
                WHERE post_id = %s AND user_id = %s
                RETURNING post_id
            """,
            (post_id, user_id),
        ).fetchone()
        if deleted is None:
            return

        conn.execute(
            """
                UPDATE posts
                SET
                    likes = GREATEST(likes - 1, 0),
                    hot_score =
                        10 * LOG(2, GREATEST(likes - 1, 1)) +
                        (created_at::date - '1970-01-01'::date)
                WHERE post_id = %s
            """,
            (post_id,),
        )


def mark_posts_viewed(user_id: str, post_ids: list[int]):
    if not post_ids:
        return

    with db_conn() as conn:
        conn.execute(
            """
                INSERT INTO post_views (post_id, user_id)
                SELECT post_id, %s
                FROM unnest(%s) AS post_id
                ON CONFLICT (post_id, user_id) DO NOTHING
            """,
            (user_id, post_ids),
        )


def get_posts(user_id: str, post_ids: list[int]) -> list[dict]:
    """Display fields for the given posts, in request order. Missing ids are skipped."""
    if not post_ids:
        return []

    ordered_unique: list[int] = list(dict.fromkeys(post_ids))

    with db_conn() as conn:
        rows = conn.execute(
            """
                SELECT
                    p.post_id,
                    p.content,
                    p.likes,
                    p.created_at,
                    pr.username,
                    EXISTS (
                        SELECT 1 FROM post_likes
                        WHERE post_likes.post_id = p.post_id
                          AND post_likes.user_id = %s
                    ) AS liked
                FROM posts p
                LEFT JOIN profile pr ON pr.uid = p.user_id
                WHERE p.post_id = ANY(%s)
            """,
            (user_id, ordered_unique),
        ).fetchall()

    by_id = {row["post_id"]: row for row in rows}
    posts = []
    for post_id in ordered_unique:
        row = by_id.get(post_id)
        if row is None:
            continue
        posts.append(
            {
                "post_id": row["post_id"],
                "content": row["content"],
                "likes": row["likes"],
                "created_at": row["created_at"],
                "liked": row["liked"],
                "author": {"username": row["username"] or "unknown"},
            }
        )
    return posts


def _get_user_vector(user_id: str) -> ndarray | None:
    genres = top_k_of_interest(user_id, "genre", 10)
    artists = top_k_of_interest(user_id, "artist", 10)

    total_weighted_embeddings = sum(
        [
            interest.embedding * interest.score
            for interest in [*genres, *artists]
            if interest.score != 0 and interest.embedding is not None
        ]
    )
    if isinstance(total_weighted_embeddings, int):
        return None

    return total_weighted_embeddings / np.linalg.norm(total_weighted_embeddings)


def get_post_similarities(
    model: SentenceTransformer, rows: list[DictRow], user_vector: ndarray | None
) -> list[float]:
    if user_vector is None:
        return [0 for _ in rows]

    embeddings = [str_to_embedding(row["embedding"]) for row in rows]
    embeddings = np.stack(embeddings, axis=0)
    similarities = model.similarity(user_vector, embeddings)
    return similarities.squeeze().tolist()


def similar_and_recent_posts(user_id: str, user_vector: ndarray | None, n: int):
    if user_vector is None:
        return []

    # how much similarity score is equivalent to 1 day of post age
    AGE_MULTIPLIER = 0.02
    user_vector_w_age = np.append(AGE_MULTIPLIER, user_vector)

    with db_conn() as conn:
        return conn.execute(
            """
                SELECT post_id, embedding, likes, created_at FROM posts
                WHERE NOT EXISTS (
                    SELECT 1 FROM post_views
                    WHERE post_views.post_id = posts.post_id
                      AND post_views.user_id = %s
                )
                ORDER BY embedding_w_bday <#> %s
                LIMIT %s
            """,
            (user_id, embedding_to_str(user_vector_w_age), n),
        ).fetchall()


def hot_posts(user_id: str, n: int):
    with db_conn() as conn:
        return conn.execute(
            """
                SELECT post_id, embedding, likes, created_at FROM posts
                WHERE NOT EXISTS (
                    SELECT 1 FROM post_views
                    WHERE post_views.post_id = posts.post_id
                      AND post_views.user_id = %s
                )
                ORDER BY hot_score DESC
                LIMIT %s
            """,
            (user_id, n),
        ).fetchall()


def get_feed(model: SentenceTransformer, user_id: str, n: int):
    user_vector = _get_user_vector(user_id)
    sources = [
        similar_and_recent_posts(user_id, user_vector, n),
        hot_posts(user_id, n),
    ]

    posts = [post for source in sources for post in source]  # flatten
    posts = list({p["post_id"]: p for p in posts}.values())  # deduplicate

    if len(posts) == 0:
        return []

    similiarities = get_post_similarities(model, posts, user_vector)

    scored_posts = []
    for post, similarity in zip(posts, similiarities):
        likes_score = 10 * math.log2(post["likes"] + 1)
        age_score = (datetime.now(UTC) - post["created_at"]).days
        similarity_score = similarity * 50

        score = likes_score + age_score + similarity_score
        scored_posts.append((score, post["post_id"]))

    scored_posts.sort(reverse=True)
    return scored_posts[:n]

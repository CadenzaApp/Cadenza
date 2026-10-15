import math
from datetime import date, timedelta

import numpy as np
from sentence_transformers import SentenceTransformer

from interests import *
from util import *


# todo: in the future, include post tags in the text to embed
def post_embedding(model: SentenceTransformer, content: str) -> np.ndarray:
    return model.encode_document(content)


POSTS_EPOCH = datetime(year=2026, month=1, day=1, tzinfo=UTC)


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


def like_post(post_id: int):
    with db_conn() as conn:
        conn.execute(
            """
                UPDATE posts
                SET 
                    likes = likes + 1,
                    hot_score = 
                        10 * LOG(2, likes + 1) + 
                        (created_at::date - '1970-01-01'::date)
                WHERE post_id=%s;
            """,
            (post_id,),
        )


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


def similar_and_recent_posts(user_vector: ndarray | None, n: int):
    if user_vector is None:
        return []

    AGE_MULTIPLIER = (
        0.02  # how much similarity score is equivalent to 1 day of post age
    )
    user_vector = np.append(AGE_MULTIPLIER, user_vector)

    with db_conn() as conn:
        return conn.execute(
            """
                SELECT post_id, embedding, likes, created_at FROM posts 
                ORDER BY embedding_w_bday <#> %s
                LIMIT %s
            """,
            (embedding_to_str(user_vector), n),  # type: ignore
        ).fetchall()


def hot_posts(n: int):
    with db_conn() as conn:
        return conn.execute(
            """
                SELECT post_id, embedding, likes, created_at FROM posts 
                ORDER BY hot_score DESC
                LIMIT %s
            """,
            (n,),
        ).fetchall()


def get_feed(model: SentenceTransformer, user_id: str, n: int):
    user_vector = _get_user_vector(user_id)
    sources = [similar_and_recent_posts(user_vector, n), hot_posts(n)]
    print([s["post_id"] for s in sources[0]])

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

import math
from datetime import date, timedelta

import numpy as np
from sentence_transformers import SentenceTransformer

from interests import *
from util import *


# todo: in the future, include post tags in the text to embed
def post_embedding(model: SentenceTransformer, content: str) -> np.ndarray:
    return model.encode_document(content)


def create_post(model: SentenceTransformer, user_id: str, content: str):
    with db_conn() as conn, conn.cursor() as cur:
        embedding = embedding_to_str(post_embedding(model, content))
        row = cur.execute(
            """
                INSERT INTO posts (user_id, content, embedding)
                VALUES (%s, %s, %s)
                RETURNING post_id
            """,
            (user_id, content, embedding),
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
    """Not normalized!"""

    genres = top_k_of_interest(user_id, "genre", 10)
    artists = top_k_of_interest(user_id, "artist", 10)

    if len(genres) == 0 and len(artists) == 0:
        return None

    total_weighted_embeddings = sum(
        [
            interest.embedding * interest.score
            for interest in [*genres, *artists]
            if interest.score != 0 and interest.embedding is not None
        ]
    )
    return total_weighted_embeddings  # type: ignore


def get_post_similarities(
    model: SentenceTransformer, rows: list[DictRow], user_vector: ndarray | None
) -> list[float]:
    if user_vector is None:
        return [0 for _ in rows]

    embeddings = [str_to_embedding(row["embedding"]) for row in rows]
    embeddings = np.stack(embeddings, axis=0)
    similarities = model.similarity(user_vector, embeddings)
    return similarities.squeeze().tolist()

def posts_similar_to_user(user_id: str, n: int):
    user_vector = _get_user_vector(user_id)
    if user_vector is None:
        return []

    with db_conn() as conn:
        return conn.execute(
            """
                SELECT post_id, embedding, likes, created_at FROM posts 
                ORDER BY embedding <=> %s
                LIMIT %s
            """,
            (embedding_to_str(user_vector), n),
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
    sources = [posts_similar_to_user(user_id, n), hot_posts(n)]

    posts = [post for source in sources for post in source]  # flatten
    posts = list({p["post_id"]: p for p in posts}.values())  # deduplicate

    if len(posts) == 0:
        return []

    similiarities = get_post_similarities(model, posts, _get_user_vector(user_id))

    scored_posts = []
    for post, similarity in zip(posts, similiarities):

        likes_score = 10 * math.log2(post["likes"] + 1)
        age_score =  (datetime.now(UTC) - post["created_at"]).days
        similarity_score = similarity * 50

        score = likes_score + age_score + similarity_score
        scored_posts.append((score, post["post_id"]))

    scored_posts.sort(reverse=True)
    return scored_posts[:n]

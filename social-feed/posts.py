from sentence_transformers import SentenceTransformer

from interests import *
from util import *


# todo: in the future, include post tags in the text to embed
def post_embedding(model: SentenceTransformer, content: str) -> np.ndarray:
    return model.encode_document(content)

def create_post(model: SentenceTransformer, user_id: str, content: str):
    with db_conn() as conn, conn.cursor() as cur:
        embedding = embedding_to_str(post_embedding(model, content))
        cur.execute(
            """
                INSERT INTO posts (user_id, content, embedding)
                VALUES (%s, %s, %s)
            """,
            (user_id, content, embedding),
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


class PostAndEmbedding(BaseModel, arbitrary_types_allowed=True):
    post_id: int
    embedding: ndarray | None

    @staticmethod
    def from_sql_row(row):
        return PostAndEmbedding(
            post_id=row["post_id"],
            embedding=str_to_embedding(row["embedding"]),
        )


def posts_similar_to_user(user_id: str, n: int):
    user_vector = _get_user_vector(user_id)
    if user_vector is None:
        return []

    with db_conn() as conn:
        rows = conn.execute(
            """
                SELECT post_id, embedding FROM posts 
                ORDER BY embedding <=> %s
                LIMIT %s
            """,
            (embedding_to_str(user_vector), n),
        ).fetchall()
        return [PostAndEmbedding.from_sql_row(row) for row in rows]

def hot_posts(n: int):
    with db_conn() as conn:
        rows = conn.execute(
            """
                SELECT post_id, embedding FROM posts 
                ORDER BY embedding <=> %s
                LIMIT %s
            """,
            (n,),
        ).fetchall()
        return [PostAndEmbedding.from_sql_row(row) for row in rows]



def get_feed(user_id: str, n: int):
    sources = [posts_similar_to_user(user_id, n)]
    return [s.post_id for s in sources[0]]

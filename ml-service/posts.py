from sentence_transformers import SentenceTransformer

from interests import *
from util import *


# todo: in the future, include post tags in the text to embed
def post_embedding(model: SentenceTransformer, content: str) -> np.ndarray:
    return model.encode_document(content)

def create_post_embedding(model: SentenceTransformer, post_id: int):
    with db_conn() as conn, conn.cursor() as cur:
        # fetch post content
        post_content = cur.execute(
            """
                SELECT content FROM posts WHERE post_id=%s;
            """,
            (post_id,),
        ).fetchone()
        if post_content is None:
            return
        post_content = post_content["content"]  # type: ignore

        # create embedding and put in db
        embedding = embedding_to_str(post_embedding(model, post_content))
        cur.execute(
            """
                UPDATE posts
                SET embedding = %s
                WHERE post_id=%s;
            """,
            (embedding, post_id),
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

    with db_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
                SELECT post_id, embedding FROM posts 
                ORDER BY embedding <=> %s
                LIMIT %s
            """,
            (embedding_to_str(user_vector), n),
        )
        return [PostAndEmbedding.from_sql_row(row) for row in cur.fetchall()]


def get_feed(user_id: str, n: int):
    sources = [posts_similar_to_user(user_id, n)]
    return [s.post_id for s in sources[0]]

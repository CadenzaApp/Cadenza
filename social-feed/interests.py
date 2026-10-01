from datetime import UTC, datetime, timedelta
from typing import Literal

import numpy as np
from fastapi import HTTPException
from numpy import ndarray
from psycopg.errors import ForeignKeyViolation
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

from util import *

logger = get_logger(__name__, "interests")

type InterestType = Literal["genre", "artist"]
INTEREST_TYPE_TO_PREFIX: dict[InterestType, str] = {
    "genre": "the music genre ",
    "artist": "the music artist ",
}


class Interest(BaseModel, arbitrary_types_allowed=True):
    id: int
    name: str
    embedding: ndarray | None
    score: int
    interest_type: InterestType

    @staticmethod
    def from_sql_rows(rows):
        return [
            Interest(
                id=row["interest_id"],
                name=row["name"],
                embedding=str_to_embedding(row.get("embedding", None)),
                score=row["score"],
                interest_type=row["interest_type"],
            )
            for row in rows
        ]


def interest_embeddings(
    model: SentenceTransformer, interests: list[tuple[str, InterestType]]
) -> list[np.ndarray]:
    logger.info(f"embedding {len(interests)} interests")
    res = model.encode_query(
        [INTEREST_TYPE_TO_PREFIX[itype] + name for name, itype in interests]
    )
    return [x for x in res]


def top_k_of_interest(
    user_id: str, interest_type: InterestType, k: int
) -> list[Interest]:
    with db_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
                SELECT * FROM interests NATURAL JOIN interest_scores
                WHERE user_id=%s AND embedding IS NOT NULL AND interest_type=%s
                ORDER BY score DESC
                LIMIT %s
            """,
            (user_id, interest_type, k),
        )
        return Interest.from_sql_rows(cur.fetchall())


class InterestScoreUpdate(BaseModel):
    name: str
    itype: InterestType
    delta: int


def update_interests(
    model: SentenceTransformer, user_id: str, updates: list[InterestScoreUpdate]
):
    if len(updates) == 0:
        return

    with db_conn() as conn, conn.cursor() as cur:
        # ensure interests exist
        cur.executemany(
            """
                INSERT INTO interests (name, interest_type)
                VALUES (%s, %s)
                ON CONFLICT (name, interest_type) DO UPDATE SET name=EXCLUDED.name
                RETURNING interest_id, name, interest_type, (embedding IS NOT NULL) as embedding_exists;
            """,
            [(upd.name, upd.itype) for upd in updates],
            returning=True,
        )
        rows = [cur.fetchone() for _ in cur.results()]

        # find interests without embeddings and create embeddings for them
        interests_to_embed: list[dict] = [
            row for row in rows if row and not row["embedding_exists"]
        ]
        if len(interests_to_embed) > 0:
            embeddings = interest_embeddings(
                model, [(i["name"], i["interest_type"]) for i in interests_to_embed]
            )

            # put new embeddings into db
            cur.executemany(
                """
                    UPDATE interests 
                    SET embedding = %s
                    WHERE interest_id = %s;
                """,
                [
                    (embedding_to_str(embedding), i["interest_id"])
                    for i, embedding in zip(interests_to_embed, embeddings)
                ],
            )
        else:
            logger.info("updated interests are all already embedded")

        # update interest scores
        name_type_to_id = {
            (i["name"], i["interest_type"]): i["interest_id"] for i in rows if i
        }
        try:
            cur.executemany(
                """
                    INSERT INTO interest_scores (user_id, interest_id, score)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (user_id, interest_id) DO UPDATE SET
                        score = interest_scores.score + EXCLUDED.score
                """,
                [
                    (user_id, name_type_to_id[(upd.name, upd.itype)], upd.delta)
                    for upd in updates
                ],
            )
        except ForeignKeyViolation:
            raise HTTPException(status_code=404, detail="No user found with that uuid")


def decay_interests(user_id: str):
    DECAY_COEFFICIENT = 0.6
    DECAY_COOLDOWN = timedelta(hours=6)

    # if a user's highest interest is below this, don't decay
    INTEREST_THRESHOLD = 3

    with db_conn() as conn, conn.cursor() as cur:
        # cancel if decayed recently
        row = cur.execute(
            """
                SELECT decayed_at FROM interest_scores_metadata
                WHERE user_id=%s;
            """,
            (user_id,),
        ).fetchone()
        if (
            row is not None
            and (datetime.now(UTC) - row["decayed_at"]) <= DECAY_COOLDOWN
        ):
            logger.info(
                f"decay is cooldown so didn't decay, user_id={user_id} decayed_at={row['decayed_at']}"
            )
            return

        # cancel if max score is below threshold
        row = cur.execute(
            """
                SELECT MAX(score) AS max_score FROM interest_scores
                WHERE user_id=%s;
            """,
            (user_id,),
        ).fetchone()
        if row is None or row["max_score"] <= INTEREST_THRESHOLD:
            logger.info(
                f"max score below threshold so didn't decay, user_id={user_id} max_score={row['max_score'] if row else 'none'}"
            )
            return

        # decay interest scores and update decayed_at
        cur.execute(
            """
                UPDATE interest_scores
                SET score = score * %s
                WHERE user_id = %s;
            """,
            (DECAY_COEFFICIENT, user_id),
        )
        cur.execute(
            """
                INSERT INTO interest_scores_metadata (user_id)
                VALUES (%s)
                ON CONFLICT (user_id) DO UPDATE
                    SET decayed_at = now()
                    WHERE user_id = EXCLUDED.user_id;
            """,
            (user_id,),
        )

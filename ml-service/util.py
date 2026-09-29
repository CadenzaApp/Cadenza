import json
import os

import numpy as np
import psycopg
from psycopg.rows import dict_row


def db_conn():
    return psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row)  # type: ignore


def embedding_to_str(embedding: np.ndarray):
    return f"[{','.join(map(str, embedding))}]"


def str_to_embedding(embedding_str: str | None) -> np.ndarray | None:
    return np.array(json.loads(embedding_str)) if embedding_str else None

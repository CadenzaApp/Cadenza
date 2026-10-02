import json
import os
import logging, sys

import numpy as np
import psycopg
from psycopg.rows import dict_row, DictRow
from psycopg import Connection


def db_conn() -> Connection[DictRow]:
    return psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) # type: ignore

def embedding_to_str(embedding: np.ndarray):
    return f"[{','.join(map(str, embedding))}]"


def str_to_embedding(embedding_str: str) -> np.ndarray:
    return np.array(json.loads(embedding_str))

def get_logger(name: str, tag: str):
    logger = logging.getLogger(name)
    log_handler = logging.StreamHandler(stream=sys.stdout)
    log_handler.setFormatter(logging.Formatter(f"[{tag}] " + "%(levelname)s: %(message)s"))
    return logger

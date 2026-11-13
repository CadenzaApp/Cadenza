import os
import asyncio
from model_queue import ModelBusy, ModelQueue

from dotenv import load_dotenv

load_dotenv()

from typing import Literal

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, FiniteFloat, field_validator
from sentence_transformers import SentenceTransformer

app = FastAPI()
model = SentenceTransformer(
    "google/embeddinggemma-300m",
    revision=os.environ["MODEL_REVISION"],
    token=os.environ["HF_TOKEN"],
)
model.similarity_fn_name = "cosine"
model_work = ModelQueue()


@app.exception_handler(ModelBusy)
async def model_busy(request: Request, exc: ModelBusy):
    return JSONResponse(status_code=503, content={"detail": "Model busy; retry later"}, headers={"Retry-After": "5"})


@app.exception_handler(asyncio.TimeoutError)
async def model_timeout(request: Request, exc: asyncio.TimeoutError):
    return JSONResponse(status_code=504, content={"detail": "Model operation timed out"})


INTEREST_PREFIX = {
    "genre": "the music genre ",
    "artist": "the music artist ",
}


class InterestText(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    itype: Literal["genre", "artist"]


class EmbeddingBody(BaseModel):
    """One post's text, and/or interest names that still need a stored vector."""

    content: str | None = Field(default=None, max_length=1024)
    interests: list[InterestText] = Field(default_factory=list, max_length=100)


class EmbeddingResponse(BaseModel):
    embedding: list[float] | None = None
    interest_embeddings: list[list[float]] = Field(default_factory=list)


class SimilarityPost(BaseModel):
    post_id: int
    embedding: list[FiniteFloat] = Field(max_length=768)


class SimilarityBody(BaseModel):
    user_vector: list[FiniteFloat] = Field(max_length=768)
    posts: list[SimilarityPost] = Field(max_length=1000)

    @field_validator("user_vector")
    @classmethod
    def vector_size(cls, value):
        if len(value) not in (0, 768):
            raise ValueError("expected empty or 768-dimensional vector")
        return value


class PostSimilarity(BaseModel):
    post_id: int
    similarity: float


class SimilarityResponse(BaseModel):
    similarities: list[PostSimilarity]


def _as_floats(vector: np.ndarray) -> list[float]:
    return [float(x) for x in np.asarray(vector).reshape(-1).tolist()]


@app.get("/health/ready")
async def ready() -> dict[str, str]:
    """Import completes only after the pinned model has loaded."""
    return {"status": "ready"}


@app.post("/embedding")
async def embed(body: EmbeddingBody) -> EmbeddingResponse:
    # One worker keeps inference serial even if its HTTP caller disconnects.
    return await model_work.run(_embed, body)


def _embed(body: EmbeddingBody) -> EmbeddingResponse:
    """Document embedding for a post, and query embeddings for interest names.

    Posts use `encode_document`. Interests use `encode_query` with the genre or
    artist prefix. Nothing here is read from a database.
    """
    if body.content is None and not body.interests:
        raise HTTPException(status_code=422, detail="content or interests is required")

    embedding = None
    if body.content is not None:
        embedding = _as_floats(model.encode_document(body.content))

    interest_embeddings: list[list[float]] = []
    if body.interests:
        encoded = np.atleast_2d(
            model.encode_query(
                [INTEREST_PREFIX[item.itype] + item.name for item in body.interests]
            )
        )
        interest_embeddings = [_as_floats(row) for row in encoded]

    return EmbeddingResponse(
        embedding=embedding,
        interest_embeddings=interest_embeddings,
    )


@app.post("/posts/similarities")
async def similarity(body: SimilarityBody) -> SimilarityResponse:
    return await model_work.run(_similarity, body)


def _similarity(body: SimilarityBody) -> SimilarityResponse:
    """Cosine similarity of each stored post vector to the user vector.

    The user vector is already the normalized weighted sum, computed by the
    Rust api. An empty user vector, or a post with no embedding, scores that
    post at 0.
    """
    if not body.posts:
        return SimilarityResponse(similarities=[])

    user_vector = np.asarray(body.user_vector, dtype=float)
    usable = [post for post in body.posts if post.embedding]
    if user_vector.size == 0 or not usable:
        return SimilarityResponse(
            similarities=[
                PostSimilarity(post_id=post.post_id, similarity=0.0)
                for post in body.posts
            ]
        )

    embeddings = np.stack([np.asarray(post.embedding, dtype=float) for post in usable])
    scores = model.similarity(user_vector, embeddings).squeeze()
    values = np.atleast_1d(np.asarray(scores, dtype=float)).tolist()
    by_id = {
        post.post_id: float(score) for post, score in zip(usable, values)
    }
    return SimilarityResponse(
        similarities=[
            PostSimilarity(post_id=post.post_id, similarity=by_id.get(post.post_id, 0.0))
            for post in body.posts
        ]
    )

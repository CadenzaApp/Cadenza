import os

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

from interests import *
from posts import *

app = FastAPI()
model = SentenceTransformer("google/embeddinggemma-300m", token=os.environ["HF_TOKEN"])


@app.get("/feed")
async def get_feed_route(user_id: str, n: int):
    return get_feed(user_id, n)


class UpdateInterestsBody(BaseModel):
    user_id: str
    delta_scores: list[InterestScoreUpdate]

@app.patch("/interests")
async def update_interests_route(body: UpdateInterestsBody):
    update_interests(model, body.user_id, body.delta_scores)


class EmbedPostBody(BaseModel):
    post_id: int

@app.post("/posts/embeddings")
async def embed_post_route(body: EmbedPostBody):
    create_post_embedding(model, body.post_id)

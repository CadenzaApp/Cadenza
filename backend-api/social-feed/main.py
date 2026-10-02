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
model.similarity_fn_name = "cosine"


@app.get("/feed")
async def get_feed_route(user_id: str):
    FEED_SIZE = 100; # todo: allow fetching past FEED_SIZE
    return {"feed": get_feed(model, user_id, 100)}


class UpdateInterestsBody(BaseModel):
    user_id: str
    delta_scores: list[InterestScoreUpdate]


@app.patch("/interests/update")
async def update_interests_route(body: UpdateInterestsBody):
    update_interests(model, body.user_id, body.delta_scores)


class DecayInterestsBody(BaseModel):
    user_id: str


@app.patch("/interests/decay")
async def decay_interests_route(body: DecayInterestsBody):
    decay_interests(body.user_id)


class CreatePostBody(BaseModel):
    user_id: str
    content: str


@app.post("/posts")
async def create_post_route(body: CreatePostBody):
    return {"post_id": create_post(model, body.user_id, body.content)}


class LikePostBody(BaseModel):
    user_id: str  # todo: unused, track user likes later

@app.post("/posts/{post_id}/likes")
async def like_post_route(post_id: int, body: LikePostBody):
    like_post(post_id)

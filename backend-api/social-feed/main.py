import os

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

from interests import *
from posts import *

app = FastAPI()
model = SentenceTransformer("google/embeddinggemma-300m", token=os.environ["HF_TOKEN"])
model.similarity_fn_name = "cosine"


@app.get("/feed")
async def get_feed_route(user_id: str):
    FEED_SIZE = 100; # todo: allow fetching past FEED_SIZE
    return {"feed": get_feed(model, user_id, FEED_SIZE)}


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


POST_CONTENT_MAX = 500


class CreatePostBody(BaseModel):
    user_id: str
    content: str = Field(max_length=POST_CONTENT_MAX)


@app.post("/posts")
async def create_post_route(body: CreatePostBody):
    return {"post_id": create_post(model, body.user_id, body.content)}


class GetPostsBody(BaseModel):
    post_ids: list[int]


@app.post("/posts/batch")
async def get_posts_route(body: GetPostsBody):
    return {"posts": get_posts(body.post_ids)}


class LikePostBody(BaseModel):
    user_id: str
    timestamp: int


def _apply_like(user_id: str, post_id: int, timestamp: int, apply):
    if not accept_like_interaction(user_id, post_id, timestamp):
        return
    try:
        apply()
    except Exception:
        forget_like_interaction(user_id, post_id, timestamp)
        raise


@app.post("/posts/{post_id}/likes")
async def like_post_route(post_id: int, body: LikePostBody):
    _apply_like(
        body.user_id,
        post_id,
        body.timestamp,
        lambda: like_post(body.user_id, post_id),
    )


@app.delete("/posts/{post_id}/likes")
async def unlike_post_route(post_id: int, body: LikePostBody):
    _apply_like(
        body.user_id,
        post_id,
        body.timestamp,
        lambda: unlike_post(body.user_id, post_id),
    )


class MarkPostsViewedBody(BaseModel):
    user_id: str
    post_ids: list[int]


@app.post("/posts/views")
async def mark_posts_viewed_route(body: MarkPostsViewedBody):
    mark_posts_viewed(body.user_id, body.post_ids)

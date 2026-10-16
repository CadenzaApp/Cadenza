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
async def get_feed_route(user_id: str, include_seen_posts: bool = False):
    FEED_SIZE = 100; # todo: allow fetching past FEED_SIZE
    return {"feed": get_feed(model, user_id, FEED_SIZE, include_seen_posts)}


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
    user_id: str
    post_ids: list[int]


@app.post("/posts/batch")
async def get_posts_route(body: GetPostsBody):
    return {"posts": get_posts(body.user_id, body.post_ids)}


@app.get("/posts/user/{author_id}")
async def get_user_posts_route(author_id: str, user_id: str):
    """Posts by `author_id`, newest first. `user_id` is the viewer (for liked)."""
    return get_user_posts(user_id, author_id)


class LikePostBody(BaseModel):
    user_id: str
    timestamp: int


@app.post("/posts/{post_id}/likes")
async def like_post_route(post_id: int, body: LikePostBody):
    if not accept_like_interaction(body.user_id, post_id, body.timestamp):
        return
    try:
        like_post(body.user_id, post_id)
    except Exception:
        forget_like_interaction(body.user_id, post_id, body.timestamp)
        raise


@app.delete("/posts/{post_id}/likes")
async def unlike_post_route(post_id: int, body: LikePostBody):
    if not accept_like_interaction(body.user_id, post_id, body.timestamp):
        return
    try:
        unlike_post(body.user_id, post_id)
    except Exception:
        forget_like_interaction(body.user_id, post_id, body.timestamp)
        raise


class MarkPostsViewedBody(BaseModel):
    user_id: str
    post_ids: list[int]


@app.post("/posts/views")
async def mark_posts_viewed_route(body: MarkPostsViewedBody):
    mark_posts_viewed(body.user_id, body.post_ids)

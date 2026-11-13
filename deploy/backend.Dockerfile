ARG UV_IMAGE
ARG RUST_IMAGE=rust:1.98.1-bookworm
ARG PYTHON_IMAGE=python:3.13-slim-bookworm
FROM ${UV_IMAGE} AS uv_binary
FROM ${RUST_IMAGE} AS build
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend-api
COPY backend-api/Cargo.toml backend-api/Cargo.lock ./
COPY backend-api/src ./src
RUN cargo build --release --locked

FROM ${PYTHON_IMAGE}
COPY --from=uv_binary /uv /usr/local/bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend-api/ml-service
COPY backend-api/ml-service/pyproject.toml backend-api/ml-service/uv.lock ./
ENV UV_NO_CACHE=1
RUN uv sync --locked --no-dev --no-install-project --python /usr/local/bin/python
COPY backend-api/ml-service/main.py backend-api/ml-service/model_queue.py ./
COPY --from=build /app/backend-api/target/release/cadenza-backend-api /usr/local/bin/cadenza-api
RUN mkdir -p /cache/huggingface && chown -R 10001:10001 /cache/huggingface
ENV PATH="/app/backend-api/ml-service/.venv/bin:$PATH" PYTHONUNBUFFERED=1 HF_HOME=/cache/huggingface
WORKDIR /app/backend-api
USER 10001:10001
CMD ["cadenza-api"]

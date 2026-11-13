# Deployment files and technical reference

> Current architecture: one t4g.medium (4 GiB), no load balancer or overlapping
> rollout. Automatic replacement with downtime is planned. Use DEPLOYMENT_PLAN.md
> and deploy/README.md for current decisions and operations; older sizing,
> acceptance-test gates, and human-only workflow details below are historical.

> Current deployment uses CloudFront-managed public HTTPS with a home-only
> viewer function and a private EC2 VPC origin. No domain purchase, Elastic IP,
> or direct public EC2 web ingress is required. Axum serves the origin directly. Use [deploy/README.md](deploy/README.md)
> and its applied CloudFront configuration for this deployment.

Use this alongside [the operator tutorial](DEPLOYMENT_TUTORIAL.md). The applied
files and verification records are in [deploy/](deploy/README.md). Examples below
explain the setup; use the applied files for the current deployment.

A developer completes the build preparation once. The operator then uses the saved
configuration and diagnostic commands. All examples use one backend container:
Rust starts its Python child; no separate proxy container is required.

## Build preparation

No external-model Rust change is required. Keep this existing line in main.rs:

```rust
let _ml_service = social_feed::spawn_ml_service();
```

Rust will start Python inside the same container and connect to it at
http://127.0.0.1:3001. Do not add ML_SERVICE_EXTERNAL or start Python separately.
If you already applied the earlier tutorial's external-model flag, leave it unset
or set it to false so the child starts.

The packaging must preserve the path Rust expects. It uses CARGO_MANIFEST_DIR,
which is captured when Rust compiles, to find ml-service/.venv/bin/python. The
Dockerfile below builds Rust at /app/backend-api and installs Python's environment at
/app/backend-api/ml-service/.venv in the runtime image. Do not change one path
without changing the other. This avoids an application refactor for deployment.

The reviewed code caps its database pool at 10, uses session mode on 5432, and
clears default-tag in-flight claims at startup. Confirm Supabase can accommodate
10 connections plus administration. Stop other API instances during testing
against the same project.

There are no /health/live or /health/ready endpoints yet. This tutorial checks
/test for HTTP reachability and the private model's /openapi.json for model-server
startup. Neither proves database readiness or successful inference. The operator
tutorial verifies both with real requests.

A failed Python child can leave Rust running. The combined container health check
will report unhealthy, but Docker does not restart a container just because that
check fails. For this staffed demo, the operator restarts the whole backend when
that happens. The Rehearse a model crash section walks through that recovery.
Automatic child-process supervision can be added later for unattended operation.

LAPTOP: in backend-api/ml-service/pyproject.toml, add `"torch"` to the existing
project dependencies and add this configuration, merging with any existing tables:

```toml
[tool.uv.sources]
torch = [{ index = "pytorch-cpu", marker = "sys_platform == 'linux'" }]

[[tool.uv.index]]
name = "pytorch-cpu"
url = "https://download.pytorch.org/whl/cpu"
explicit = true
```

From backend-api/ml-service, run:

```sh
uv lock --python 3.13
```

Resolve any incompatibility before continuing. Select mutually compatible pinned
versions if the CPU index does not carry the version required by another package.
Do not overwrite a locked installation with a later pip install. This follows
[uv's CPU-index approach](https://docs.astral.sh/uv/guides/integration/pytorch/).

On the model's Hugging Face Files page, copy a full commit SHA. In main.py replace
the model construction with:

```python
model = SentenceTransformer(
    "google/embeddinggemma-300m",
    revision=os.environ["MODEL_REVISION"],
    token=os.environ["HF_TOKEN"],
)
```

This introduces a NEW variable, MODEL_REVISION. Set it in local development
too. Keep HF_TOKEN available at runtime: the code still reads it even offline.
Do not change embedding precision or model identity for deployment without checking
that embeddings remain compatible with vectors already stored in Supabase.

Update backend-api/README.md and the model README to document these final setup
changes. Run `cargo fmt --check` and `cargo check --locked` in backend-api. Run
database-connected tests only against a disposable test database. A test suite
must not silently inherit the live demo DATABASE_URL.

Success: code compiles, the lockfile resolves, and the new configuration variables
are documented. The later ARM image test is still required.

## Combined Dockerfile

LAPTOP: create deploy/ at the repo root. Save deploy/backend.Dockerfile:

```dockerfile
ARG UV_IMAGE
FROM ${UV_IMAGE} AS uv_binary
FROM rust:1.98.1-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend-api
COPY backend-api/Cargo.toml backend-api/Cargo.lock ./
COPY backend-api/src ./src
RUN cargo build --release --locked

FROM python:3.13-slim-bookworm
COPY --from=uv_binary /uv /usr/local/bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend-api/ml-service
COPY backend-api/ml-service/pyproject.toml backend-api/ml-service/uv.lock ./
ENV UV_NO_CACHE=1
RUN uv sync --locked --no-dev --no-install-project --python /usr/local/bin/python
COPY backend-api/ml-service/main.py ./main.py
COPY --from=build /app/backend-api/target/release/cadenza-backend-api /usr/local/bin/cadenza-api
RUN mkdir -p /cache/huggingface && chown -R 10001:10001 /cache/huggingface
ENV PATH="/app/backend-api/ml-service/.venv/bin:$PATH" PYTHONUNBUFFERED=1 HF_HOME=/cache/huggingface
WORKDIR /app/backend-api
USER 10001:10001
CMD ["cadenza-api"]
```

The runtime image contains both the Rust binary and Python installation. Rust
launches exactly one Python worker on 127.0.0.1:3001. Only Rust's port is published through the private origin port mapping. The cache directory is writable by the runtime user; a fresh Docker named
volume inherits that directory's contents and ownership. If reusing a volume with
other ownership, correct its ownership before loading the model.

Use the version in rust-toolchain.toml if it changes. Select an ARM-capable uv
image version from ghcr.io/astral-sh/uv and record its digest as UV_IMAGE. Resolve
the Rust and Python base tags to digests for the release record too. Confirm the
image tags exist and the locked dependencies compile before publishing. Do not
put HF_TOKEN in build arguments or image layers.

Create or merge this repo-root .dockerignore; preserve existing exclusions:

```text
.git
**/.env
**/.env.*
**/.venv
**/target
**/node_modules
**/__pycache__
**/*.pem
**/*.p8
**/*.key
output
```

The Dockerfile copies only the required code/manifests. Inspect the context for
other credential files before building. Do not copy your local venv into Linux.
Remove or archive the earlier separate API/model Dockerfile examples so the
operator uses only this combined recipe.

## Publish the backend image

In ECR -> Private repositories, create cadenza-backend in Oregon. Enable
immutable tags. Retain the current and prior release; cap older image retention.

LAPTOP: authenticate AWS CLI with your normal SSO/profile and run
`aws sts get-caller-identity`. Confirm the intended account and that your identity
can push to this repository. Replace the account, uv digest, and release identifier below. Use a new
release tag after every edit; never overwrite an existing release.

```sh
export AWS_REGION=us-west-2
export CADENZA_ACCOUNT=YOUR_ACCOUNT_ID
export CADENZA_REGISTRY="$CADENZA_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"
export CADENZA_RELEASE=demo-001
export CADENZA_UV_IMAGE=ghcr.io/astral-sh/uv@sha256:YOUR_VERIFIED_DIGEST
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$CADENZA_REGISTRY"
docker buildx build --platform linux/arm64 --build-arg UV_IMAGE="$CADENZA_UV_IMAGE" -f deploy/backend.Dockerfile -t "$CADENZA_REGISTRY/cadenza-backend:$CADENZA_RELEASE" --push .
```

Native ARM builds are preferable; emulation may be slow. Build on the laptop or
an existing CI builder, not the memory-constrained demo instance. Confirm the image
architecture with `docker buildx imagetools inspect IMAGE_REFERENCE`. In ECR copy
the combined backend image digest. Runtime configuration will use repository@sha256:digest rather
than mutable tags. ECR login tokens expire; repeat login when needed, as described
in [ECR authentication](https://docs.aws.amazon.com/AmazonECR/latest/userguide/registry_auth.html).

## Secret retrieval script

EC2, root shell: save this as /opt/cadenza/fetch-secrets.py:

```python
import json
import os
import subprocess
from pathlib import Path

groups = {
    "api": ["DATABASE_URL", "OPENAI_API_KEY", "APPLE_MUSIC_DEVELOPER_TOKEN"],
    "ml": ["HF_TOKEN"],
}
for group, keys in groups.items():
    raw = subprocess.check_output([
        "aws", "ssm", "get-parameter", "--region", "us-west-2",
        "--name", f"/cadenza/demo/{group}", "--with-decryption",
        "--query", "Parameter.Value", "--output", "text",
    ], text=True)
    values = json.loads(raw)
    lines = []
    for key in keys:
        value = values[key]
        if not isinstance(value, str) or not value or any(c in value for c in "\r\n\0"):
            raise ValueError(f"Invalid value for {key}")
        lines.append(f"{key}={value}\n")
    path = Path(f"/opt/cadenza/secrets/{group}.env")
    temporary = path.with_suffix(".tmp")
    temporary.write_text("".join(lines))
    os.chmod(temporary, 0o600)
    temporary.replace(path)
```

Run `python3 fetch-secrets.py`. No output means success. Check permissions with
`ls -l secrets`; do not cat these files or run a verbose Compose config dump.
The Compose definition below uses raw env-file parsing to preserve literal dollar
signs and quotes. It requires Docker Compose 2.30 or later. If retrieval fails,
correct IAM, region, parameter names, or JSON before continuing.

After rotating either parameter, rerun this script and recreate the combined
backend with `docker compose --env-file release.env up -d --force-recreate backend`.
A plain restart does not reload an updated env file. Both processes restart; verify
the affected flow after recreation. Both secret files are used by this container.

## Runtime files

Use the applied [compose.yaml](deploy/compose.yaml) and
[release.env.example](deploy/release.env.example), rather than maintaining
another copy of the runtime template here. On EC2, save them in `/opt/cadenza`
as `compose.yaml` and `release.env`. Release settings are nonsecret:

```text
BACKEND_IMAGE=ACCOUNT_ID.dkr.ecr.us-west-2.amazonaws.com/cadenza-backend@sha256:BACKEND_DIGEST
MODEL_REVISION=YOUR_FULL_MODEL_COMMIT_SHA
```

The only service is backend. Docker maps host port 80 to Axum port 3000. The EC2
security group permits port 80 only from CloudFront's service-managed group;
Python port 3001 is not published. CloudFront terminates public HTTPS and supplies
the public hostname. No proxy image, certificate volumes, or origin hostname
setting is needed in the backend release environment.

Keep the model cache volume and the root-only secret files. Both API and model
checks must pass for backend health, then verify a real embedding. Health status
alone does not restart a hung process; a failed Python child still needs a backend
restart. `start-release.sh` performs startup checks without a RAM sampler.

## Check an embedding

Run this in the EC2 root shell from /opt/cadenza after the backend is healthy.
It makes a real inference request without exposing Python's port publicly.

```sh
docker compose --env-file release.env exec -T backend python - <<'PYTEST'
import json
import urllib.request
body = json.dumps({"content": "A warm jazz track for studying"}).encode()
req = urllib.request.Request("http://127.0.0.1:3001/embedding", data=body,
    headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=60) as response:
    vector = json.load(response)["embedding"]
assert vector and all(isinstance(x, (int, float)) for x in vector)
print("Embedding succeeded; dimensions:", len(vector))
PYTEST
```

Expect `Embedding succeeded` and a positive dimension count. This verifies model
inference; use the phone to verify database-backed requests separately.

## Rehearse a model crash

Use this only before the event, after the combined backend is healthy. It stops
Python intentionally so you can verify the failure is visible and practice recovery.

```sh
docker compose --env-file release.env exec -T backend python - <<'PYTEST'
import os
import signal
from pathlib import Path
for entry in Path("/proc").iterdir():
    if not entry.name.isdigit():
        continue
    try:
        args = (entry / "cmdline").read_bytes().split(b"\0")
        if b"uvicorn" in args and b"main:app" in args:
            os.kill(int(entry.name), signal.SIGTERM)
            print("Stopped model child", entry.name)
            break
    except (FileNotFoundError, ProcessLookupError, PermissionError):
        continue
else:
    raise SystemExit("No model child found; inspect logs")
PYTEST
```

The container should become unhealthy after repeated checks. Rust may still answer
/test. Recover with `docker compose --env-file release.env restart backend`, wait
for healthy status, then repeat the embedding and phone checks. Both Rust and
Python restart together. The Docker health check itself does not trigger a restart.

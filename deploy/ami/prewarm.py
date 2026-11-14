"""Builder-only: cache an image/model without starting Rust or fetching API secrets."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

image, revision, key, base = sys.argv[1:]


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def output(args):
    return subprocess.check_output(args, text=True)


registry = image.split("/")[0]
region = registry.split(".")[3]
with tempfile.TemporaryDirectory(dir="/run", prefix="cadenza-ecr-") as config:
    password = output(["aws", "ecr", "get-login-password", "--region", region])
    run(
        [
            "docker",
            "--config",
            config,
            "login",
            "--username",
            "AWS",
            "--password-stdin",
            registry,
        ],
        input=password,
        stdout=subprocess.DEVNULL,
    )
    run(["docker", "--config", config, "pull", image])
run(["docker", "volume", "create", "cadenza_model_cache"], stdout=subprocess.DEVNULL)
values = json.loads(
    output(
        [
            "aws",
            "ssm",
            "get-parameter",
            "--region",
            region,
            "--name",
            "/cadenza/demo/ml",
            "--with-decryption",
            "--query",
            "Parameter.Value",
            "--output",
            "text",
        ]
    )
)
# The token is stdin only: never a Docker environment value, argument or disk file.
program = """import sys,math; from sentence_transformers import SentenceTransformer
model=SentenceTransformer("google/embeddinggemma-300m", revision=sys.argv[1], token=sys.stdin.read(), device="cpu")
vector=model.encode_document("A quiet jazz evening")
assert len(vector)==768 and all(math.isfinite(float(v)) for v in vector)
"""
run(
    [
        "docker",
        "run",
        "--rm",
        "-i",
        "--entrypoint",
        "python",
        "-e",
        "HF_HUB_OFFLINE=0",
        "-e",
        "OMP_NUM_THREADS=1",
        "-e",
        "TOKENIZERS_PARALLELISM=false",
        "-v",
        "cadenza_model_cache:/cache/huggingface",
        image,
        "-c",
        program,
        revision,
    ],
    input=values["HF_TOKEN"],
    stdout=subprocess.DEVNULL,
)
assert not output(["docker", "ps", "-aq"]).strip()
root = Path("/opt/cadenza")
root.joinpath("prewarm.json").write_text(
    json.dumps(
        {
            "image": image,
            "model_revision": revision,
            "bake_key": key,
            "cold_base_ami": base,
            "model_validated": True,
            "startup_prefetch": "targeted-python-model-v1",
        }
    )
)
run(["python3", "prefetch-startup.py"])
root.joinpath("bake.ready").touch()

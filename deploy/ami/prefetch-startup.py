"""Warm cached runtime/model files without Rust, network or application secrets."""

import json
import subprocess
from pathlib import Path

root = Path("/opt/cadenza")
metadata = json.loads(root.joinpath("prewarm.json").read_text())
try:
    subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "--name",
            "cadenza-startup-prefetch",
            "--pull",
            "never",
            "--read-only",
            "--network",
            "none",
            "--entrypoint",
            "python",
            "-e",
            "PYTHONDONTWRITEBYTECODE=1",
            "-e",
            "MODEL_REVISION=" + metadata["model_revision"],
            "-v",
            "cadenza_model_cache:/cache/huggingface:ro",
            "-i",
            metadata["image"],
            "-",
        ],
        input=root.joinpath("read-startup-files.py").read_text(),
        text=True,
        check=True,
        timeout=240,
    )
finally:
    # Also remove the container if a hung CLI or read exceeds the startup budget.
    subprocess.run(
        ["docker", "rm", "-f", "cadenza-startup-prefetch"],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=10,
    )

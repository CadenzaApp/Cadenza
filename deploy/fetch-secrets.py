"""Run as root on EC2 to write SSM secrets without printing their values."""

import json
import os
import subprocess
import tempfile
from pathlib import Path

GROUPS = {
    "api": ("DATABASE_URL", "OPENAI_API_KEY", "APPLE_MUSIC_DEVELOPER_TOKEN"),
    "ml": ("HF_TOKEN",),
}


def fetch_group(group: str, keys: tuple[str, ...], region: str) -> str:
    # Capture stderr too: callers should inspect IAM and parameter names rather
    # than copy potentially sensitive CLI output into chat.
    try:
        result = subprocess.run(
            [
                "aws",
                "ssm",
                "get-parameter",
                "--region",
                region,
                "--name",
                f"/cadenza/demo/{group}",
                "--with-decryption",
                "--query",
                "Parameter.Value",
                "--output",
                "text",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError:
        raise ValueError(
            f"SSM retrieval failed for {group}; check region, IAM, and parameter name"
        ) from None
    try:
        values = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise ValueError(f"Invalid JSON in SSM parameter {group}") from None
    if not isinstance(values, dict):
        raise ValueError(f"SSM parameter {group} must be a JSON object")
    lines = []
    for key in keys:
        value = values.get(key)
        if not isinstance(value, str) or not value or any(c in value for c in "\r\n\0"):
            raise ValueError(f"Invalid value for {key}")
        lines.append(f"{key}={value}\n")
    return "".join(lines)


def main() -> None:
    if os.geteuid() != 0:
        raise SystemExit("Run as root on EC2 from /opt/cadenza")
    os.umask(0o077)
    directory = Path("/opt/cadenza/secrets")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory.chmod(0o700)
    try:
        # Validate both responses before replacing either deployed file.
        settings = dict(
            line.split("=", 1)
            for line in Path("/opt/cadenza/release.env").read_text().splitlines()
            if line and not line.startswith("#")
        )
        region = settings["BACKEND_IMAGE"].split(".")[3]
        payloads = {
            group: fetch_group(group, keys, region) for group, keys in GROUPS.items()
        }
    except (ValueError, FileNotFoundError) as error:
        raise SystemExit(str(error)) from None
    for group, payload in payloads.items():
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", dir=directory, delete=False
            ) as stream:
                temporary = Path(stream.name)
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            temporary.replace(directory / f"{group}.env")
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()

"""Check real inference inside the backend container; no database access."""

import json
import math
import argparse
from pathlib import Path
import time
import urllib.request


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--requests", type=int, default=1)
    parser.add_argument("--interval", type=float, default=0)
    parser.add_argument("--timeout", type=float, default=60, help="Per-request startup check timeout in seconds")
    parser.add_argument("--content-file", type=Path, help="Longest expected post, inside the container")
    args = parser.parse_args()
    if args.requests < 1 or args.interval < 0 or args.timeout <= 0:
        parser.error("requests/timeout must be positive and interval must be nonnegative")
    content = args.content_file.read_text() if args.content_file else "A warm jazz track for studying"
    body = json.dumps({"content": content}).encode()
    for index in range(args.requests):
        request = urllib.request.Request(
            "http://127.0.0.1:3001/embedding", data=body,
            headers={"Content-Type": "application/json"},
        )
        started = time.monotonic()
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            vector = json.load(response)["embedding"]
        if not isinstance(vector, list) or len(vector) != 768:
            raise SystemExit("Unexpected embedding dimensions")
        if not all(type(x) in (int, float) and math.isfinite(x) for x in vector):
            raise SystemExit("Invalid embedding values")
        print(f"Embedding {index + 1} succeeded; dimensions: {len(vector)}; seconds: {time.monotonic() - started:.3f}", flush=True)
        if index + 1 < args.requests:
            time.sleep(args.interval)


if __name__ == "__main__":
    main()
